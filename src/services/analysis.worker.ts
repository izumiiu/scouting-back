import mongoose from 'mongoose';
import { Analysis } from '../models/Analysis.js';
import { ScoutingCase } from '../models/ScoutingCase.js';
import { AuditEvent } from '../models/AuditEvent.js';
import type { AiProvider } from './ai.contract.js';
import { AppError } from '../utils/errors.js';
import {
  RULE_VERSION,
  PROMPT_VERSION,
  EXPERT_VERSION,
} from '../domain/catalog.js';
import { tedCriteria } from '../domain/ted-criteria.js';
export async function processNextAnalysis(
  provider: AiProvider,
): Promise<boolean> {
  const expired = await Analysis.findOne({
    status: 'running',
    leaseUntil: { $lt: new Date() },
  });
  if (expired) {
    await mongoose.connection.transaction(async (session) => {
      const changed = await Analysis.updateOne(
        {
          _id: expired._id,
          status: 'running',
          leaseUntil: { $lt: new Date() },
        },
        {
          $set: {
            status: 'failed',
            error: 'งานวิเคราะห์หมดเวลา/worker หยุดทำงาน กรุณาลองใหม่',
            finishedAt: new Date(),
          },
        },
        { session },
      );
      if (changed.modifiedCount)
        await ScoutingCase.updateOne(
          { _id: expired.caseId, activeAnalysisId: expired._id },
          { $set: { activeAnalysisId: null } },
          { session },
        );
    });
    return true;
  }
  const run = await Analysis.findOneAndUpdate(
    { status: 'queued' },
    {
      $set: {
        status: 'running',
        startedAt: new Date(),
        leaseUntil: new Date(Date.now() + 90000),
      },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  );
  if (!run) return false;
  try {
    // Never process an old queued request with a different prompt/rule version.
    if (
      run.ruleVersion !== RULE_VERSION ||
      run.promptVersion !== PROMPT_VERSION ||
      run.expertVersion !== EXPERT_VERSION ||
      run.tedCriteriaSnapshot?.version !== tedCriteria.version
    )
      throw new AppError(
        409,
        'AI_RULES_CHANGED',
        'เกณฑ์วิเคราะห์เปลี่ยนหลังเข้าคิว กรุณาสั่งวิเคราะห์ใหม่',
      );
    if (run.provider !== provider.name)
      throw new AppError(
        409,
        'AI_PROVIDER_CHANGED',
        'ผู้ให้บริการ AI เปลี่ยนหลังเข้าคิว กรุณาสั่งวิเคราะห์ใหม่',
      );
    const permission = await ScoutingCase.exists({
      _id: run.caseId,
      organizationId: run.organizationId,
      'input.allowAiProcessing': true,
      'input.permissionStatus': 'granted',
    });
    if (!permission)
      throw new AppError(
        403,
        'AI_PERMISSION_REVOKED',
        'ไม่ได้ส่งข้อมูลให้ AI เพราะขอบเขตการอนุญาตเปลี่ยนไป',
      );
    const { result, requestId } = await provider.analyze(run.toObject());
    await mongoose.connection.transaction(async (session) => {
      const finished = await Analysis.updateOne(
        { _id: run._id, status: 'running' },
        {
          $set: {
            status: 'succeeded',
            result,
            providerRequestId: requestId,
            finishedAt: new Date(),
            leaseUntil: null,
          },
        },
        { session },
      );
      if (!finished.modifiedCount) return;
      await ScoutingCase.updateOne(
        { _id: run.caseId, activeAnalysisId: run._id },
        { $set: { activeAnalysisId: null } },
        { session },
      );
      await ScoutingCase.updateOne(
        { _id: run.caseId, revision: run.inputRevision },
        { $set: { latestAnalysisId: run._id } },
        { session },
      );
      await AuditEvent.create(
        [
          {
            caseId: run.caseId,
            organizationId: run.organizationId,
            actor: run.requestedBy,
            actorName: 'ระบบ AI',
            action: 'บันทึกผล AI (รอคนตรวจ)',
            revision: run.inputRevision,
            details: {
              analysisId: run._id,
              ruleVersion: run.ruleVersion,
              promptVersion: run.promptVersion,
            },
          },
        ],
        { session },
      );
    });
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : 'วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่ภายหลัง';
    await mongoose.connection.transaction(async (session) => {
      const failed = await Analysis.updateOne(
        { _id: run._id, status: 'running' },
        {
          $set: {
            status: 'failed',
            error: message,
            finishedAt: new Date(),
            leaseUntil: null,
          },
        },
        { session },
      );
      if (failed.modifiedCount)
        await ScoutingCase.updateOne(
          { _id: run.caseId, activeAnalysisId: run._id },
          { $set: { activeAnalysisId: null } },
          { session },
        );
    });
  }
  return true;
}
export function startAnalysisWorker(provider: AiProvider): () => Promise<void> {
  let stopped = false;
  let task: Promise<void> | null = null;
  const tick = () => {
    if (stopped || task) return;
    task = processNextAnalysis(provider)
      .then(() => undefined)
      .catch(() => {
        console.error(
          JSON.stringify({
            event: 'worker_error',
            message: 'Database operation failed',
          }),
        );
      })
      .finally(() => {
        task = null;
      });
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await task;
  };
}
