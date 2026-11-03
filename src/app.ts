import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ErrorRequestHandler } from 'express';
import type { Config } from './config/env.js';
import { apiRoutes } from './routes/api.routes.js';
import { csrfGuard } from './middleware/security.js';
import { AppError } from './utils/errors.js';
export function createApp(config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          ...(config.production ? {} : { upgradeInsecureRequests: null }),
        },
      },
    }),
  );
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });
  app.use(
    cors({
      origin: config.origin,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Requested-With', 'Idempotency-Key'],
      methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '150kb', strict: true }));
  app.use(cookieParser());
  app.get('/healthz', (_req, res) =>
    res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
      status: mongoose.connection.readyState === 1 ? 'ready' : 'unavailable',
    }),
  );
  app.use(
    '/api',
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    csrfGuard(config.origin),
    apiRoutes(config),
  );
  app.use('/api', (_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'ไม่พบ API ที่ร้องขอ')),
  );
  if (existsSync(resolve(config.frontendDist, 'index.html'))) {
    app.use(
      express.static(config.frontendDist, {
        index: false,
        maxAge: config.production ? '1h' : 0,
      }),
    );
    app.use((req, res, next) => {
      if (req.method === 'GET')
        res.sendFile(resolve(config.frontendDist, 'index.html'));
      else next();
    });
  }
  const handler: ErrorRequestHandler = (error, req, res, _next) => {
    const known = error instanceof AppError;
    const malformed = error instanceof SyntaxError && 'body' in error;
    const duplicate =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 11000;
    const tooLarge =
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large';
    const status = tooLarge
      ? 413
      : known
        ? error.status
        : malformed
          ? 400
          : duplicate
            ? 409
            : 500;
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: 'request_failed',
          requestId: req.requestId,
          code: known ? error.code : 'INTERNAL_ERROR',
        }),
      );
    res.status(status).json({
      error: {
        code: tooLarge
          ? 'PAYLOAD_TOO_LARGE'
          : known
            ? error.code
            : duplicate
              ? 'CONFLICT'
              : malformed
                ? 'INVALID_JSON'
                : 'INTERNAL_ERROR',
        message: tooLarge
          ? 'ข้อมูลมีขนาดเกินกำหนด กรุณาย่อข้อความ'
          : known
            ? error.message
            : duplicate
              ? 'คำขอซ้ำหรือมีการบันทึกพร้อมกัน กรุณาโหลดใหม่'
              : malformed
                ? 'รูปแบบ JSON ไม่ถูกต้อง'
                : 'ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่',
        requestId: req.requestId,
      },
    });
  };
  app.use(handler);
  return app;
}
