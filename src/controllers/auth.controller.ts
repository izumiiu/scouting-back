import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Staff } from '../models/Staff.js';
import { object, text } from '../validators/case.validator.js';
import { AppError } from '../utils/errors.js';
import { actorOf } from '../middleware/auth.js';
import type { Config } from '../config/env.js';
// A valid cost-12 hash keeps unknown-account comparisons on the password hashing path.
const dummyHash =
  '$2b$12$KIX8FsYrI7SpzjoKM.VBbeRjJYa2I.hXQaGz0KdGJjslO4Ww1C9bO';
export const authController = (config: Config) => ({
  login: async (req: Request, res: Response) => {
    const body = object(req.body),
      email = text(body.email, 'อีเมล', 180).toLowerCase();
    if (
      typeof body.password !== 'string' ||
      Buffer.byteLength(body.password) > 72
    )
      throw new AppError(400, 'INVALID_INPUT', 'รหัสผ่านไม่ถูกต้อง');
    const password = body.password;
    const user = await Staff.findOne({ email, active: true }).select(
      '+passwordHash',
    );
    const valid = await bcrypt.compare(
      password,
      user?.passwordHash ?? dummyHash,
    );
    if (!user || !valid)
      throw new AppError(
        401,
        'INVALID_CREDENTIALS',
        'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      );
    const token = jwt.sign({ version: user.tokenVersion }, config.jwtSecret, {
      subject: String(user._id),
      expiresIn: '8h',
      algorithm: 'HS256',
      issuer: 'nu-seed-scouting',
      audience: 'scouting-web',
    });
    res.cookie('scouting_session', token, {
      httpOnly: true,
      secure: config.production,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/api',
    });
    res.json({
      user: { id: String(user._id), name: user.name, email: user.email },
    });
  },
  me: async (req: Request, res: Response) => {
    const a = actorOf(req);
    res.json({ user: { id: a.id, name: a.name, email: a.email } });
  },
  logout: async (req: Request, res: Response) => {
    const a = actorOf(req);
    await Staff.updateOne({ _id: a.id }, { $inc: { tokenVersion: 1 } });
    res.clearCookie('scouting_session', {
      httpOnly: true,
      secure: config.production,
      sameSite: 'lax',
      path: '/api',
    });
    res.status(204).end();
  },
});
