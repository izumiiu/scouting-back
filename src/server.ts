import mongoose from 'mongoose';
import { loadConfig } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { startAnalysisWorker } from './services/analysis.worker.js';
import { OpenAiProvider } from './services/openai.service.js';
import { Staff } from './models/Staff.js';
import { ScoutingCase } from './models/ScoutingCase.js';
import { Analysis } from './models/Analysis.js';
import { Review } from './models/Review.js';
import { AuditEvent } from './models/AuditEvent.js';
import { RateBucket } from './models/RateBucket.js';
try {
  const config = loadConfig();
  await connectDatabase(config.mongoUri);
  await Promise.all([
    Staff.init(),
    ScoutingCase.init(),
    Analysis.init(),
    Review.init(),
    AuditEvent.init(),
    RateBucket.init(),
  ]);
  const stop = config.workerEnabled
    ? startAnalysisWorker(new OpenAiProvider(config))
    : async () => {};
  const server = createApp(config).listen(config.port, () =>
    console.info(`Scouting server listening on port ${config.port}`),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await stop();
    await mongoose.disconnect();
  };
  process.on('SIGTERM', () => void close());
  process.on('SIGINT', () => void close());
} catch {
  console.error(
    'เริ่มระบบไม่ได้ โปรดตรวจ .env การเชื่อม MongoDB และสิทธิ์เครือข่าย (ไม่แสดง URI/key ใน log)',
  );
  process.exitCode = 1;
}
