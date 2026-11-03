import 'dotenv/config';
const required = [
  'MONGODB_URI',
  'JWT_SECRET',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
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
  'This checks presence only; it does not call Atlas/OpenAI or display secret values.',
);
if (!complete) process.exitCode = 1;
