import 'dotenv/config';
const provider = process.env.AI_PROVIDER?.trim() || 'openai';
if (provider !== 'openai' && provider !== 'groq') {
  console.error('AI_PROVIDER: invalid (choose openai or groq)');
  process.exit(1);
}
console.info(`AI_PROVIDER: ${provider}`);
const required = [
  'MONGODB_URI',
  'JWT_SECRET',
  provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY',
  provider === 'groq' ? 'GROQ_MODEL' : 'OPENAI_MODEL',
  'APP_ORIGIN',
] as const;
let complete = true;
for (const key of required) {
  const value = process.env[key] ?? '';
  const ready =
    key === 'JWT_SECRET' ? value.length >= 32 : value.trim().length > 0;
  console.info(`${key}: ${ready ? 'configured' : 'missing'}`);
  if (!ready) complete = false;
}
console.info(
  'This checks presence only; it does not call Atlas or AI providers or display secret values.',
);
if (!complete) process.exitCode = 1;
