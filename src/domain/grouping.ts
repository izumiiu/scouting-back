import type { Answers, GroupContext } from './types.js';
export function deriveGroup(a: Answers): GroupContext {
  const unknown = (message: string): GroupContext => ({
    group: null,
    status: 'unknown',
    warnings: [message],
  });
  if (a.bandsVerified !== 'ใช่')
    return unknown(
      'ค่าประเภทและสามมิติยังไม่ได้รับการตรวจยืนยันโดยเจ้าหน้าที่',
    );
  if (!a.originType || !a.trlBand || !a.crlBand)
    return unknown('ยังขาดประเภท TRL หรือ CRL สามช่วง');
  const prefix =
    a.originType === 'ก: เทคโนโลยี/ไอเดีย'
      ? 'ก'
      : a.originType === 'ข: ตลาด'
        ? 'ข'
        : null;
  if (!prefix) return unknown('ประเภทที่อ้างยังไม่ชัด');
  if (a.trlBand === 'ต้น' || a.crlBand === 'ต้น')
    return { group: `${prefix}-1`, status: 'confirmed-inputs', warnings: [] };
  if (a.trlBand === 'พร้อม' && a.crlBand === 'พร้อม') {
    if (!a.brlBand) return unknown('ต้องมี BRL เพื่อแยกระยะ 2/3');
    if (a.brlBand !== 'ต้น')
      return unknown(
        'ผู้เข้าเงื่อนไขระยะ 3 ต้องตรวจหมายเหตุตรวจย้อนระยะ 1–2 กับ PM ก่อนยืนยันกลุ่ม',
      );
  }
  if (prefix === 'ข' && a.brlBand === 'ต้น')
    return unknown(
      'คำอธิบาย ข-1 กับกฎระยะอาจขัดกัน ต้องให้ PM ชี้แจงก่อนยืนยันกลุ่ม',
    );
  return { group: `${prefix}-2`, status: 'confirmed-inputs', warnings: [] };
}
