import { fields } from '../domain/catalog.js';
import { validDate } from '../domain/eligibility.js';
import type { Answers, CaseInput } from '../domain/types.js';
import { badRequest } from '../utils/errors.js';
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw badRequest('รูปแบบข้อมูลไม่ถูกต้อง');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== 'string' || value.length > max)
    throw badRequest(`${label}: ข้อความไม่ถูกต้องหรือยาวเกินกำหนด`);
  return value.trim();
}
export function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw badRequest(`${label}: ต้องเป็นจำนวนเต็มบวกหรือศูนย์`);
  return value;
}
export function parseCaseInput(raw: unknown): CaseInput {
  const v = object(raw),
    answers = object(v.answers),
    parsed: Answers = {};
  const known = new Map(fields.map((f) => [f.id, f]));
  for (const [key, value] of Object.entries(answers)) {
    const f = known.get(key);
    if (!f) throw badRequest(`ไม่รู้จักช่องข้อมูล ${key}`);
    if (value === null || value === '') {
      parsed[key] = null;
      continue;
    }
    if (f.type === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > (f.max ?? 1e9)
      )
        throw badRequest(`${f.label}: ตัวเลขไม่ถูกต้อง`);
      if (
        ['A4', 'A5', 'preInMonths', 'trlNumeric'].includes(key) &&
        !Number.isInteger(value)
      )
        throw badRequest(`${f.label}: ต้องเป็นจำนวนเต็ม`);
      if (key === 'trlNumeric' && value < 1)
        throw badRequest('TRL ต้องอยู่ระหว่าง 1–9');
      parsed[key] = value;
    } else if (f.type === 'multi') {
      if (
        !Array.isArray(value) ||
        value.length > (f.max ?? 30) ||
        value.some((x) => typeof x !== 'string' || !f.options?.includes(x)) ||
        new Set(value).size !== value.length
      )
        throw badRequest(`${f.label}: ตัวเลือกไม่ถูกต้อง`);
      const exclusive =
        key === 'D4' ? 'ยังไม่มี' : key === 'E2' ? 'ยังไม่ได้ทำเพิ่ม' : null;
      if (exclusive && value.includes(exclusive) && value.length > 1)
        throw badRequest(
          `${f.label}: ตัวเลือกว่าไม่มี/ยังไม่ได้ทำเพิ่มขัดกับตัวเลือกอื่น กรุณาตรวจเอกสารต้นทาง`,
        );
      parsed[key] = value as string[];
    } else {
      const str = text(value, f.label);
      if (f.type === 'select' && !f.options?.includes(str))
        throw badRequest(`${f.label}: ตัวเลือกไม่ถูกต้อง`);
      if (f.type === 'date' && !validDate(str))
        throw badRequest(`${f.label}: วันที่ไม่ถูกต้อง`);
      parsed[key] = str;
    }
  }
  const title = text(v.title, 'ชื่อกิจการ/เคส', 180);
  if (!title) throw badRequest('โปรดระบุชื่อกิจการ/เคส');
  const referenceDate = text(v.referenceDate, 'วันที่อ้างอิง', 10);
  if (!validDate(referenceDate)) throw badRequest('วันที่อ้างอิงไม่ถูกต้อง');
  for (const key of ['bornOn', 'registeredOn', 'graduatedOn'])
    if (typeof parsed[key] === 'string' && parsed[key] > referenceDate)
      throw badRequest('วันเกิด/จดทะเบียน/จบการศึกษาต้องไม่เกินวันที่อ้างอิง');
  const permissionStatus = v.permissionStatus;
  if (!['unknown', 'granted', 'denied'].includes(String(permissionStatus)))
    throw badRequest('สถานะการอนุญาตไม่ถูกต้อง');
  if (typeof v.allowAiProcessing !== 'boolean')
    throw badRequest('ระบุขอบเขตการใช้ AI');
  const permissionReference = text(
    v.permissionReference,
    'หลักฐานการอนุญาต',
    500,
  );
  if (
    v.allowAiProcessing &&
    (permissionStatus !== 'granted' || !permissionReference)
  )
    throw badRequest(
      'ต้องมีการอนุญาตและหลักฐานที่ครอบคลุมการใช้ AI ก่อนเปิดส่งข้อมูล',
    );
  return {
    title,
    contactName: text(v.contactName, 'ชื่อผู้ติดต่อ', 180),
    contactPhone: text(v.contactPhone, 'โทรศัพท์', 80),
    contactEmail: text(v.contactEmail, 'อีเมล', 180),
    sourceChannel: text(v.sourceChannel, 'ช่องทาง', 100),
    sourceReference: text(v.sourceReference, 'เลขอ้างอิง', 500),
    referenceDate,
    permissionStatus: permissionStatus as CaseInput['permissionStatus'],
    permissionReference,
    allowAiProcessing: v.allowAiProcessing,
    answers: parsed,
  };
}
