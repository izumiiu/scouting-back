import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Staff } from '../models/Staff.js';
import { AppError } from '../utils/errors.js';
import type { Config } from '../config/env.js';
export interface Actor {
  id: string;
  organizationId: string;
  name: string;
  email: string;
}
declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      requestId?: string;
    }
  }
}
export function actorOf(req: Request): Actor {
  if (!req.actor)
    throw new AppError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  return req.actor;
}
export const authentication =
  (config: Config) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token: unknown = req.cookies?.scouting_session;
      if (typeof token !== 'string') throw new Error('No session');
      const claims = jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'nu-seed-scouting',
        audience: 'scouting-web',
      });
      if (
        typeof claims === 'string' ||
        typeof claims.sub !== 'string' ||
        !/^[a-f\d]{24}$/i.test(claims.sub)
      )
        throw new Error('Invalid claims');
      const user = await Staff.findOne({
        _id: claims.sub,
        active: true,
      }).lean();
      if (!user || user.tokenVersion !== claims.version)
        throw new Error('Revoked');
      req.actor = {
        id: String(user._id),
        organizationId: user.organizationId,
        name: user.name,
        email: user.email,
      };
      next();
    } catch {
      next(new AppError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบอีกครั้ง'));
    }
  };
