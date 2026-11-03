import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { RateBucket } from '../models/RateBucket.js';
import { AppError } from '../utils/errors.js';
export const csrfGuard =
  (origin: string) => (req: Request, _res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    if (
      req.get('X-Requested-With') !== 'ScoutingWeb' ||
      (req.get('Origin') && req.get('Origin') !== origin)
    ) {
      next(new AppError(403, 'FORBIDDEN', 'คำขอไม่ผ่านการตรวจสอบที่มา'));
      return;
    }
    next();
  };
export const rateLimit =
  (scope: string, limit: number, windowMs: number) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const window = Math.floor(Date.now() / windowMs);
      const key = createHash('sha256')
        .update(`${scope}:${req.actor?.id ?? req.ip}:${window}`)
        .digest('hex');
      const bucket = await RateBucket.findOneAndUpdate(
        { key },
        {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt: new Date((window + 1) * windowMs) },
        },
        { upsert: true, returnDocument: 'after' },
      );
      if (bucket.count > limit) {
        res.setHeader(
          'Retry-After',
          String(Math.ceil(((window + 1) * windowMs - Date.now()) / 1000)),
        );
        throw new AppError(
          429,
          'RATE_LIMITED',
          'คำขอถี่เกินไป โปรดลองใหม่ภายหลัง',
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
