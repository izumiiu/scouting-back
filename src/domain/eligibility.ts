import { programs } from './catalog.js';
import type { Answers, Condition, Eligibility, Outcome } from './types.js';
export const outcome = (value: boolean | null): Outcome =>
  value === null ? 'unknown' : value ? 'pass' : 'fail';
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function ageOn(date: string, reference: string): number {
  const a = new Date(date),
    b = new Date(reference);
  return (
    b.getUTCFullYear() -
    a.getUTCFullYear() -
    (b.toISOString().slice(5, 10) < a.toISOString().slice(5, 10) ? 1 : 0)
  );
}
function withinYears(
  date: unknown,
  reference: string,
  years: number,
): boolean | null {
  if (!validDate(date) || date > reference) return null;
  const cutoff = new Date(date);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() + years);
  return new Date(reference).getTime() <= cutoff.getTime();
}
export function evaluate(a: Answers, reference: string): Eligibility[] {
  const c = (
    id: string,
    label: string,
    value: boolean | null,
    refs: string[],
    note?: string,
  ): Condition => ({
    id,
    label,
    outcome: outcome(value),
    evidenceRefs: refs,
    ...(note ? { note } : {}),
  });
  const num = (key: string, p: (n: number) => boolean) =>
    typeof a[key] === 'number' ? p(a[key]) : null;
  const yes = (key: string) =>
    a[key] === 'ใช่' ? true : a[key] === 'ไม่ใช่' ? false : null;
  const member =
    a.A3 === 'นิสิต'
      ? true
      : a.A3 === 'ศิษย์เก่า'
        ? withinYears(a.graduatedOn, reference, 5)
        : typeof a.A3 === 'string'
          ? false
          : null;
  const ubiMember =
    (member === true && a.institution === 'มหาวิทยาลัยนเรศวร') ||
    a.A3 === 'บุคลากร/นักวิจัย'
      ? true
      : null;
  const ubi = [
    c(
      'ubi-membership',
      'คุณสมบัติ UBI/เส้นทาง Pre-in',
      ubiMember,
      ['A3', 'institution', 'graduatedOn', 'preInMonths'],
      'เส้นทางผู้ประกอบการผ่าน Pre-in และนิยามสถาบันต้องให้เจ้าของเกณฑ์รับรอง กรณีไม่ชัดเป็นข้อมูลไม่พอ',
    ),
    c(
      'ubi-entity-age',
      'นิติบุคคลอายุไม่เกิน 3 ปี (เมื่อเกี่ยวข้อง)',
      a.A6 === 'นิติบุคคล'
        ? withinYears(a.registeredOn, reference, 3)
        : a.A6 === 'ยังไม่จดทะเบียน' || a.A6 === 'ทะเบียนพาณิชย์'
          ? true
          : null,
      ['A6', 'registeredOn'],
      'เกณฑ์อ้างอิงรอรับรอง',
    ),
  ];
  const trl = (low: number, high: number) =>
    a.trlVerified === 'ใช่'
      ? num('trlNumeric', (n) => n >= low && n <= high)
      : null;
  const entity = c(
    'legal',
    'เป็นนิติบุคคล',
    typeof a.A6 === 'string' ? a.A6 === 'นิติบุคคล' : null,
    ['A6'],
  );
  const graduation = c(
    'education',
    'นิสิต หรือศิษย์เก่าจบไม่เกิน 5 ปี',
    member,
    ['A3', 'graduatedOn'],
  );
  const rules: Record<string, Condition[]> = {
    UBI_PRE: ubi,
    UBI_STARTUP: [
      ...ubi,
      c('mvp', 'มี MVP/ทดสอบตลาดที่เจ้าหน้าที่ตรวจแล้ว', yes('mvpVerified'), [
        'C2',
        'D1',
        'mvpVerified',
      ]),
    ],
    TED_IDEA: [
      graduation,
      c('thai', 'สัญชาติไทย', yes('nationalityThai'), ['nationalityThai']),
      c(
        'team',
        'ทีมรวมผู้สมัครอย่างน้อย 3 คน',
        num('A5', (n) => n >= 3),
        ['A5'],
      ),
      c('trl-idea', 'TRL 2–4 ที่มีหลักฐานตรวจแล้ว', trl(2, 4), [
        'trlNumeric',
        'trlVerified',
      ]),
      c('fellow', 'สมาชิก TED Fellow', yes('tedFellow'), ['tedFellow']),
    ],
    TED_POC: [
      entity,
      graduation,
      c(
        'thai-shares',
        'ผู้ถือหุ้นไทยอย่างน้อย 51%',
        num('thaiShares', (n) => n >= 51),
        ['thaiShares'],
      ),
      c(
        'student-shares',
        'กลุ่มนิสิต/ศิษย์เก่าที่เข้าเกณฑ์ถือหุ้นมากกว่า 30%',
        num('studentShares', (n) => n > 30),
        ['studentShares'],
        'ต้องตรวจวิธีรวมสัดส่วนหุ้นและบุคคลที่เข้าเงื่อนไข',
      ),
      c('director', 'กรรมการผู้มีอำนาจลงนาม', yes('authorizedDirector'), [
        'authorizedDirector',
      ]),
      c('trl-poc', 'TRL 5–8 ที่มีหลักฐานตรวจแล้ว', trl(5, 8), [
        'trlNumeric',
        'trlVerified',
      ]),
    ],
    TBI: [
      c(
        'age',
        'อายุ 20–60 ปี ณ วันที่อ้างอิง',
        validDate(a.bornOn)
          ? a.bornOn <= reference
            ? ageOn(a.bornOn, reference) >= 20 &&
              ageOn(a.bornOn, reference) <= 60
            : null
          : num('A4', (n) => n >= 20 && n <= 60),
        ['bornOn', 'A4'],
      ),
      entity,
      c(
        'entity-age',
        'นิติบุคคลอายุไม่เกิน 3 ปี',
        withinYears(a.registeredOn, reference, 3),
        ['registeredOn'],
      ),
      c(
        'network',
        'ไม่เคยบ่มเพาะในเครือข่ายตามนิยาม TBI',
        a.previousNetwork === 'ไม่เคย'
          ? true
          : a.previousNetwork === 'เคย'
            ? false
            : null,
        ['previousNetwork'],
      ),
    ],
  };
  return programs.map((p) => {
    const conditions = rules[p.code]!;
    return {
      program: p.code,
      label: p.label,
      conditions,
      outcome: conditions.some((x) => x.outcome === 'fail')
        ? 'fail'
        : conditions.some((x) => x.outcome === 'unknown')
          ? 'unknown'
          : 'pass',
    };
  });
}
