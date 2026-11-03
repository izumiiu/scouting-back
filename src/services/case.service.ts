import mongoose, { Types } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { ScoutingCase } from '../models/ScoutingCase.js';
import { Analysis } from '../models/Analysis.js';
import { Review } from '../models/Review.js';
import { AuditEvent } from '../models/AuditEvent.js';
import { evaluate } from '../domain/eligibility.js';
import { deriveGroup } from '../domain/grouping.js';
import {
  experts,
  programs,
  RULE_VERSION,
  EXPERT_VERSION,
  PROMPT_VERSION,
} from '../domain/catalog.js';
import type { CaseInput } from '../domain/types.js';
import type { Actor } from '../middleware/auth.js';
import { AppError, badRequest, conflict } from '../utils/errors.js';
import { object, positiveInteger, text } from '../validators/case.validator.js';
export function idOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value))
    throw badRequest('รหัสรายการไม่ถูกต้อง');
  return value;
}
export function keyOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d-]{36}$/i.test(value))
    throw badRequest('ต้องมี Idempotency-Key ที่ถูกต้อง');
  return value;
}
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scope = (id: string, actor: Actor) => ({
  _id: id,
  organizationId: actor.organizationId,
});
export async function requireCase(id: string, actor: Actor) {
  const doc = await ScoutingCase.findOne(scope(id, actor));
  if (!doc) throw new AppError(404, 'NOT_FOUND', 'ไม่พบเคสที่เข้าถึงได้');
  return doc;
}
export async function createCase(input: CaseInput, actor: Actor, key: string) {
  const prior = await ScoutingCase.findOne({
    organizationId: actor.organizationId,
    createdBy: actor.id,
    createKey: key,
  });
  if (prior) {
    if (prior.createHash !== hash(input))
      throw conflict('รหัสคำขอเดิมถูกใช้กับข้อมูลอื่น');
    return prior;
  }
  try {
    return await mongoose.connection.transaction(async (session) => {
      const [doc] = await ScoutingCase.create(
        [
          {
            code: `SC-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
            organizationId: actor.organizationId,
            input,
            titleSearch: input.title.toLocaleLowerCase('th'),
            createdBy: actor.id,
            createKey: key,
            createHash: hash(input),
          },
        ],
        { session },
      );
      if (!doc) throw new Error('Case creation failed');
      await AuditEvent.create(
        [
          {
            caseId: doc._id,
            organizationId: actor.organizationId,
            actor: actor.id,
            actorName: actor.name,
            action: 'สร้างเคส',
            revision: doc.revision,
            details: { input },
          },
        ],
        { session },
      );
      return doc;
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 11000
    ) {
      const existing = await ScoutingCase.findOne({
        organizationId: actor.organizationId,
        createdBy: actor.id,
        createKey: key,
      });
      if (existing && existing.createHash === hash(input)) return existing;
    }
    throw error;
  }
}
export async function updateCase(
  id: string,
  input: CaseInput,
  revision: number,
  actor: Actor,
) {
  return mongoose.connection.transaction(async (session) => {
    const current = await ScoutingCase.findOne({
      ...scope(id, actor),
      revision,
    }).session(session);
    if (!current) {
      await requireCase(id, actor);
      throw conflict('มีการแก้ข้อมูลแล้ว กรุณาโหลดเคสใหม่ก่อนบันทึก');
    }
    const old = current.input;
    const updated = await ScoutingCase.findOneAndUpdate(
      { ...scope(id, actor), revision },
      {
        $set: {
          input,
          titleSearch: input.title.toLocaleLowerCase('th'),
          latestAnalysisId: null,
        },
        $inc: { revision: 1 },
      },
      { session, returnDocument: 'after' },
    );
    if (!updated) throw conflict('ข้อมูลเปลี่ยนระหว่างบันทึก');
    await AuditEvent.create(
      [
        {
          caseId: id,
          organizationId: actor.organizationId,
          actor: actor.id,
          actorName: actor.name,
          action: 'แก้ข้อมูล — ผลเดิมต้องทบทวนใหม่',
          revision: updated.revision,
          details: { before: old, after: input },
        },
      ],
      { session },
    );
    return updated;
  });
}
export async function detail(id: string, actor: Actor) {
  const record = await requireCase(id, actor);
  const filter = { caseId: id, organizationId: actor.organizationId };
  const [analyses, reviews, events] = await Promise.all([
    Analysis.find(filter)
      .sort({ _id: -1 })
      .limit(15)
      .select('-inputSnapshot')
      .lean(),
    Review.find(filter).sort({ _id: -1 }).limit(15).lean(),
    AuditEvent.find(filter)
      .sort({ _id: -1 })
      .limit(30)
      .select('-details')
      .lean(),
  ]);
  return {
    caseRecord: record,
    eligibility: evaluate(record.input.answers, record.input.referenceDate),
    groupContext: deriveGroup(record.input.answers),
    analyses,
    reviews,
    events,
    historyHasMore: events.length === 30,
  };
}
export async function queueAnalysis(
  id: string,
  revision: number,
  key: string,
  actor: Actor,
  model: string,
) {
  await requireCase(id, actor);
  const prior = await Analysis.findOne({
    caseId: id,
    organizationId: actor.organizationId,
    idempotencyKey: key,
  });
  if (prior) {
    if (prior.inputRevision !== revision)
      throw conflict('รหัสคำขอเดิมอ้างข้อมูลคนละรุ่น');
    return prior;
  }
  return mongoose.connection.transaction(async (session) => {
    const current = await ScoutingCase.findOne({
      ...scope(id, actor),
      revision,
    }).session(session);
    if (!current)
      throw conflict('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนวิเคราะห์');
    if (
      !current.input.allowAiProcessing ||
      current.input.permissionStatus !== 'granted' ||
      !current.input.permissionReference
    )
      throw new AppError(
        403,
        'AI_PERMISSION_REQUIRED',
        'ยังไม่มีการอนุญาตที่ครอบคลุมการส่งข้อมูลเข้า AI',
      );
    if (current.activeAnalysisId)
      throw conflict('เคสนี้มีงานวิเคราะห์กำลังรอ/ทำงานอยู่');
    const analysisId = new Types.ObjectId();
    const locked = await ScoutingCase.updateOne(
      { ...scope(id, actor), revision, activeAnalysisId: null },
      { $set: { activeAnalysisId: analysisId } },
      { session },
    );
    if (!locked.modifiedCount)
      throw conflict('มีคำขอวิเคราะห์อื่นเริ่มก่อนแล้ว');
    const [analysis] = await Analysis.create(
      [
        {
          _id: analysisId,
          caseId: id,
          organizationId: actor.organizationId,
          inputRevision: revision,
          inputSnapshot: current.input.answers,
          referenceDate: current.input.referenceDate,
          eligibility: evaluate(
            current.input.answers,
            current.input.referenceDate,
          ),
          groupContext: deriveGroup(current.input.answers),
          ruleVersion: RULE_VERSION,
          expertVersion: EXPERT_VERSION,
          promptVersion: PROMPT_VERSION,
          provider: 'OpenAI',
          model,
          status: 'queued',
          requestedBy: actor.id,
          idempotencyKey: key,
        },
      ],
      { session },
    );
    await AuditEvent.create(
      [
        {
          caseId: id,
          organizationId: actor.organizationId,
          actor: actor.id,
          actorName: actor.name,
          action: 'ส่งคำขอ AI วิเคราะห์',
          revision,
          details: { analysisId },
        },
      ],
      { session },
    );
    if (!analysis) throw new Error('Queue insertion failed');
    return analysis;
  });
}
export async function confirmReview(
  id: string,
  raw: unknown,
  key: string,
  actor: Actor,
) {
  await requireCase(id, actor);
  const v = object(raw),
    revision = positiveInteger(v.revision, 'รุ่นข้อมูล'),
    decisionVersion = positiveInteger(v.decisionVersion, 'รุ่นคำยืนยัน'),
    analysisId = idOf(v.analysisId),
    notes = text(v.notes, 'เหตุผลการตรวจ', 3000);
  if (!notes) throw badRequest('โปรดบันทึกเหตุผลการตรวจและคำยืนยัน');
  const destination =
    v.destination === null ? null : text(v.destination, 'โครงการ', 50);
  if (destination && !programs.some((p) => p.code === destination))
    throw badRequest('โครงการปลายทางไม่ถูกต้อง');
  if (
    !Array.isArray(v.expertAreas) ||
    v.expertAreas.length > experts.length ||
    v.expertAreas.some(
      (x) => typeof x !== 'string' || !experts.some((e) => e.code === x),
    ) ||
    new Set(v.expertAreas).size !== v.expertAreas.length
  )
    throw badRequest('สาขาผู้เชี่ยวชาญไม่ถูกต้อง');
  const expertAreas = v.expertAreas as string[],
    payload = {
      revision,
      decisionVersion,
      analysisId,
      destination,
      expertAreas,
      notes,
    },
    payloadHash = hash(payload);
  const prior = await Review.findOne({
    caseId: id,
    organizationId: actor.organizationId,
    idempotencyKey: key,
  });
  if (prior) {
    if (prior.payloadHash !== payloadHash)
      throw conflict('รหัสคำขอยืนยันเดิมใช้ข้อมูลต่างกัน');
    return prior;
  }
  return mongoose.connection.transaction(async (session) => {
    const run = await Analysis.findOne({
      _id: analysisId,
      caseId: id,
      organizationId: actor.organizationId,
      status: 'succeeded',
      inputRevision: revision,
      ruleVersion: RULE_VERSION,
      expertVersion: EXPERT_VERSION,
    }).session(session);
    if (!run)
      throw conflict('ต้องมีผล AI สำเร็จของข้อมูล/เกณฑ์ปัจจุบันก่อนยืนยัน');
    if (
      destination &&
      run.eligibility.find((e) => e.program === destination)?.outcome !== 'pass'
    )
      throw badRequest(
        'ยืนยันส่งต่อได้เฉพาะโครงการที่ผ่านเงื่อนไขตามข้อมูลที่ตรวจ กรณีข้อมูลขาดให้บันทึกรอตรวจเพิ่ม',
      );
    const updated = await ScoutingCase.findOneAndUpdate(
      {
        ...scope(id, actor),
        revision,
        decisionVersion,
        activeAnalysisId: null,
        latestAnalysisId: run._id,
      },
      { $inc: { decisionVersion: 1 }, $set: { lastReviewAnalysisId: run._id } },
      { session, returnDocument: 'after' },
    );
    if (!updated)
      throw conflict(
        'ข้อมูล ผล AI หรือคำยืนยันเปลี่ยนแล้ว กรุณาโหลดและตรวจใหม่',
      );
    const [review] = await Review.create(
      [
        {
          ...payload,
          caseId: id,
          organizationId: actor.organizationId,
          inputRevision: revision,
          decisionVersion: updated.decisionVersion,
          reviewer: actor.id,
          reviewerName: actor.name,
          idempotencyKey: key,
          payloadHash,
        },
      ],
      { session },
    );
    await AuditEvent.create(
      [
        {
          caseId: id,
          organizationId: actor.organizationId,
          actor: actor.id,
          actorName: actor.name,
          action: destination
            ? 'ยืนยันเลือกโครงการส่งต่อ (ยังไม่ใช่ PM รับเรื่อง)'
            : 'ยืนยันผลตรวจ/รอข้อมูลเพิ่มเติม',
          revision,
          details: { analysisId, destination, expertAreas, notes },
        },
      ],
      { session },
    );
    return review;
  });
}
