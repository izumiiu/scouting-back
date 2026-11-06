import { describe, it, expect, vi } from 'vitest';
import { followUpScopes } from '../src/domain/follow-ups.js';
import { buildAnalysisSchema, validateAiResult } from '../src/services/ai-analysis.js';
import { evaluate } from '../src/domain/eligibility.js';
import { tedCriteria } from '../src/domain/ted-criteria.js';
import { GroqProvider } from '../src/services/groq.service.js';
import type { AnalysisData } from '../src/models/Analysis.js';
import type { Config } from '../src/config/env.js';

const run = { provider: 'Groq', model: 'fixture-model', inputSnapshot: { B1: 'ปัญหาของลูกค้า', C2: 'มีแค่ไอเดีย' }, eligibility: evaluate({}, '2026-11-06'), tedCriteriaSnapshot: structuredClone(tedCriteria), groupContext: { group: null, status: 'unknown', warnings: [] } } as unknown as AnalysisData;
const raw = {
  summary: 'แนวคิดแก้ปัญหาของลูกค้า',
  tedAssessment: { classification: 'TED_IDEA', reason: 'มีแนวคิดที่ต้องพิสูจน์', alternativeReason: 'ยังไม่มีหลักฐานการพัฒนา', evidenceRefs: ['B1', 'C2'], uncertainties: [], developmentStage: { stage: 'CONCEPT', reason: 'รายงานว่ามีเพียงแนวคิด', evidenceRefs: ['C2'] } },
  programRecommendations: [], expertRecommendations: [], missingInformation: [],
};
describe('scoped AI follow-ups without duplicate generated text', () => {
  it('requires scope and question in the provider schema', () => {
    const item = buildAnalysisSchema(run).properties.missingInformation.items;
    expect(item.required).toEqual(['scope', 'question']);
    expect(item.properties.scope.enum).toEqual([...followUpScopes]);
    expect(item.additionalProperties).toBe(false);
  });
  it('stores explicit scope metadata while preserving the existing API string array', () => {
    const questions = [
      { scope: 'TED', question: 'ขอผลทดสอบต้นแบบเพิ่มเติม' },
      { scope: 'TED_POC_FUNDING', question: 'ขอจำนวนเงินสมทบและฐานคำนวณ' },
      { scope: 'TBI', question: 'สำหรับ TBI ขอประวัติบ่มเพาะในเครือข่าย' },
      { scope: 'DEVELOPMENT', question: 'ขอสถานะสิทธิใช้เทคโนโลยีเพื่อปรึกษาผู้เชี่ยวชาญ' },
    ];
    const result = validateAiResult({ ...raw, missingInformation: questions }, run);
    expect(result.followUps).toEqual(questions);
    expect(result.missingInformation).toEqual(questions.map((item) => item.question));
    expect(result.tedAssessment?.classification).toBe('TED_IDEA');
    expect(raw).not.toHaveProperty('followUps');
  });
  it('preserves old untagged advice without guessing a program from its wording', () => {
    const result = validateAiResult({ ...raw, missingInformation: ['ขออายุผู้สมัครสำหรับ TBI'] }, run);
    expect(result.missingInformation).toEqual(['ขออายุผู้สมัครสำหรับ TBI']);
    expect(result.followUps).toBeUndefined();
  });
  it.each([
    [{ scope: 'ALL', question: 'ถามเพิ่ม' }], [{ scope: 'UPI', question: 'ถามเพิ่ม' }],
    [{ scope: 'TBI', question: '' }], [{ scope: 'TED', question: 123 }],
    [{ scope: 'TED', question: 'ถามเพิ่ม', approved: true }],
    ['ข้อความเก่า', { scope: 'TED', question: 'ถามเพิ่ม' }], [null],
  ])('rejects invalid or mixed scope entries %j', (missingInformation) => {
    expect(() => validateAiResult({ ...raw, missingInformation }, run)).toThrow();
  });
  it('does not accept a provider-supplied persistence field', () => {
    expect(() => validateAiResult({ ...raw, followUps: [{ scope: 'TBI', question: 'แอบเพิ่ม' }] }, run)).toThrow();
  });
  it('normalizes tagged transport output with only one provider request', async () => {
    const questions = [{ scope: 'TED_IDEA', question: 'ขอหลักฐานความเข้าใจผู้ใช้' }];
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...raw, missingInformation: questions }) }] }] })));
    const config = { aiProvider: 'groq', aiKey: 'fixture-not-real', aiModel: 'fixture-model' } as Config;
    const response = await new GroqProvider(config, transport).analyze(run);
    expect(response.result.followUps).toEqual(questions);
    expect(response.result.missingInformation).toEqual(['ขอหลักฐานความเข้าใจผู้ใช้']);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
