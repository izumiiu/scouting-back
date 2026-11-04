import 'dotenv/config';
import { resolve } from 'node:path';
import type { AiProviderId } from '../services/ai.contract.js';
export interface Config {
  port: number;
  mongoUri: string;
  jwtSecret: string;
  origin: string;
  production: boolean;
  trustProxyHops: number;
  aiProvider: AiProviderId;
  aiKey: string;
  aiModel: string;
  frontendDist: string;
  workerEnabled: boolean;
}
export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Config {
  const aiProvider = environment.AI_PROVIDER?.trim() || 'openai';
  if (aiProvider !== 'openai' && aiProvider !== 'groq')
    throw new Error('AI_PROVIDER ต้องเป็น openai หรือ groq');
  const production = environment.NODE_ENV === 'production';
  const jwtSecret = environment.JWT_SECRET ?? '';
  if (jwtSecret.length < 32)
    throw new Error('ตั้ง JWT_SECRET อย่างน้อย 32 ตัวอักษรใน backend/.env');
  const mongoUri = environment.MONGODB_URI ?? '';
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUri))
    throw new Error('ตั้ง MONGODB_URI ใน backend/.env');
  const origin = environment.APP_ORIGIN ?? 'http://localhost:5173';
  if (
    !/^https?:\/\//.test(origin) ||
    (production && !origin.startsWith('https://'))
  )
    throw new Error(
      'APP_ORIGIN ต้องเป็น URL ของ frontend และใช้ HTTPS ใน production',
    );
  const port = Number(environment.PORT ?? 4000),
    trustProxyHops = Number(environment.TRUST_PROXY_HOPS ?? 0);
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
    aiProvider,
    aiKey:
      (aiProvider === 'groq'
        ? environment.GROQ_API_KEY
        : environment.OPENAI_API_KEY
      )?.trim() ?? '',
    aiModel:
      (aiProvider === 'groq'
        ? environment.GROQ_MODEL
        : environment.OPENAI_MODEL
      )?.trim() ?? '',
    frontendDist: resolve(environment.FRONTEND_DIST_PATH ?? '../frontend/dist'),
    workerEnabled: environment.ENABLE_WORKER !== 'false',
  };
}
