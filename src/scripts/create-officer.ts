import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { connectDatabase } from '../config/database.js';
import { Staff } from '../models/Staff.js';
try {
  const email = process.env.OFFICER_EMAIL?.trim().toLowerCase(),
    password = process.env.OFFICER_PASSWORD,
    name = process.env.OFFICER_NAME?.trim() ?? 'เจ้าหน้าที่ NU SEED';
  if (
    !email ||
    !email.includes('@') ||
    !password ||
    password.length < 12 ||
    Buffer.byteLength(password) > 72
  )
    throw new Error(
      'Set OFFICER_EMAIL and OFFICER_PASSWORD (12+ characters, <=72 bytes) in your environment',
    );
  await connectDatabase(process.env.MONGODB_URI ?? '');
  await Staff.init();
  if (await Staff.exists({ email }))
    throw new Error('Officer already exists; no existing password was changed');
  await Staff.create({
    email,
    name,
    passwordHash: await bcrypt.hash(password, 12),
    organizationId: process.env.ORGANIZATION_ID ?? 'nu-seed',
  });
  console.info('สร้างบัญชีเจ้าหน้าที่แล้ว ไม่มีการแสดงรหัสผ่าน');
} catch {
  console.error(
    'สร้างบัญชีไม่ได้: ตรวจ MONGODB_URI, OFFICER_EMAIL, OFFICER_PASSWORD (>=12 ตัวอักษร <=72 bytes) และบัญชีซ้ำ',
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
