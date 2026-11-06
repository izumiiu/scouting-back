import type { Answers, TedAssessment, TedFundingReadiness } from './types.js';

// The existing form has no verified contribution amount/denominator. Never infer
// compliance from D5, a numeric-looking free-text claim, or the chosen TED route.
export function tedFundingReadiness(
  classification: TedAssessment['classification'],
  answers: Answers,
): TedFundingReadiness {
  if (classification !== 'TED_POC')
    return {
      status: 'NOT_ASSESSED',
      evidenceRefs: [],
      reason:
        classification === 'TED_IDEA'
          ? 'เงินสมทบอย่างน้อย 10% เป็นเงื่อนไข POC จึงยังไม่ตรวจในผลที่แนะนำ IDEA'
          : 'ยังแยก IDEA/POC ไม่ได้ จึงยังไม่ประเมินเงื่อนไขเงินสมทบ POC',
    };
  const budget = typeof answers.D5 === 'string' ? answers.D5.trim() : '';
  return {
    status: 'NEEDS_VERIFICATION',
    reason: `${budget ? `ข้อมูลเรื่องงบที่บันทึก: “${budget}” ` : 'ยังไม่มีคำตอบเรื่องงบในช่องงบพัฒนา '}ยังไม่รับรองว่ามีเงินสมทบเองอย่างน้อย 10% เจ้าหน้าที่ต้องตรวจจำนวนเงิน ฐานคำนวณ และหลักฐานตามเงื่อนไขทุน การรอตรวจนี้ไม่เปลี่ยนประเภท POC เป็น IDEA`,
    evidenceRefs: budget ? ['D5'] : [],
  };
}
