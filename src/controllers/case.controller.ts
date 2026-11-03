import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { ScoutingCase } from '../models/ScoutingCase.js';
import { AuditEvent } from '../models/AuditEvent.js';
import { actorOf } from '../middleware/auth.js';
import {
  parseCaseInput,
  object,
  positiveInteger,
} from '../validators/case.validator.js';
import {
  createCase,
  updateCase,
  detail,
  queueAnalysis,
  confirmReview,
  idOf,
  keyOf,
  requireCase,
} from '../services/case.service.js';
import { AppError, badRequest } from '../utils/errors.js';
import type { Config } from '../config/env.js';
export const caseController = (config: Config) => ({
  list: async (req: Request, res: Response) => {
    const actor = actorOf(req),
      q =
        typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '',
      cursor =
        typeof req.query.cursor === 'string'
          ? idOf(req.query.cursor)
          : undefined;
    const safe = q
      .toLocaleLowerCase('th')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      organizationId: actor.organizationId,
      ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
      ...(q
        ? {
            $or: [
              { titleSearch: { $regex: `^${safe}` } },
              {
                code: {
                  $regex: `^${q.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
                },
              },
            ],
          }
        : {}),
    };
    const rows = await ScoutingCase.find(filter)
      .sort({ _id: -1 })
      .limit(21)
      .select(
        'code input.title input.sourceChannel revision decisionVersion activeAnalysisId latestAnalysisId lastReviewAnalysisId createdAt updatedAt',
      )
      .lean();
    const items = rows.slice(0, 20);
    res.json({
      items,
      nextCursor: rows.length > 20 ? String(items.at(-1)?._id) : null,
    });
  },
  get: async (req: Request, res: Response) => {
    res.json(await detail(idOf(req.params.id), actorOf(req)));
  },
  create: async (req: Request, res: Response) => {
    res.status(201).json({
      caseRecord: await createCase(
        parseCaseInput(req.body),
        actorOf(req),
        keyOf(req.get('Idempotency-Key')),
      ),
    });
  },
  update: async (req: Request, res: Response) => {
    const v = object(req.body);
    res.json({
      caseRecord: await updateCase(
        idOf(req.params.id),
        parseCaseInput(v.input),
        positiveInteger(v.revision, 'รุ่นข้อมูล'),
        actorOf(req),
      ),
    });
  },
  analyze: async (req: Request, res: Response) => {
    if (!config.aiKey || !config.aiModel)
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        'ยังไม่ได้ตั้ง OpenAI API key/model ที่ backend กรุณาตั้งค่าก่อนวิเคราะห์',
      );
    const v = object(req.body);
    res.status(202).json({
      analysis: await queueAnalysis(
        idOf(req.params.id),
        positiveInteger(v.revision, 'รุ่นข้อมูล'),
        keyOf(req.get('Idempotency-Key')),
        actorOf(req),
        config.aiModel,
      ),
    });
  },
  review: async (req: Request, res: Response) => {
    res.status(201).json({
      review: await confirmReview(
        idOf(req.params.id),
        req.body,
        keyOf(req.get('Idempotency-Key')),
        actorOf(req),
      ),
    });
  },
  history: async (req: Request, res: Response) => {
    const id = idOf(req.params.id),
      actor = actorOf(req);
    await requireCase(id, actor);
    const cursor = req.query.cursor ? idOf(req.query.cursor) : null;
    const events = await AuditEvent.find({
      caseId: id,
      organizationId: actor.organizationId,
      ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(30)
      .lean();
    res.json({
      events,
      nextCursor: events.length === 30 ? String(events.at(-1)?._id) : null,
    });
  },
});
