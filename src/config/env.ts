import 'dotenv/config';
import { resolve } from 'node:path';
export interface Config {
  port: number;
  mongoUri: string;
  jwtSecret: string;
  origin: string;
  production: boolean;
  trustProxyHops: number;
  aiKey: string;
  aiModel: string;
  frontendDist: string;
  workerEnabled: boolean;
}
export function loadConfig(): Config {
  const production = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32)
    throw new Error('ตั้ง JWT_SECRET อย่างน้อย 32 ตัวอักษรใน backend/.env');
  const mongoUri = process.env.MONGODB_URI ?? '';
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUri))
    throw new Error('ตั้ง MONGODB_URI ใน backend/.env');
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
  if (
    !/^https?:\/\//.test(origin) ||
    (production && !origin.startsWith('https://'))
  )
    throw new Error(
      'APP_ORIGIN ต้องเป็น URL ของ frontend และใช้ HTTPS ใน production',
    );
  const port = Number(process.env.PORT ?? 4000),
    trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 5
  )
    throw new Error('PORT/TRUST_PROXY_HOPS ไม่ถูกต้อง');
  return {
    port,
    mongoUri,
    jwtSecret,
    origin: new URL(origin).origin,
    production,
    trustProxyHops,
    aiKey: process.env.OPENAI_API_KEY ?? '',
    aiModel: process.env.OPENAI_MODEL ?? '',
    frontendDist: resolve(process.env.FRONTEND_DIST_PATH ?? '../frontend/dist'),
    workerEnabled: process.env.ENABLE_WORKER !== 'false',
  };
}
