import { describe, it, expect } from 'vitest';
import {
  validateAiResult,
  buildAnalysisInput,
} from '../src/services/ai-analysis.js';
import { evaluate } from '../src/domain/eligibility.js';
import { tedCriteria } from '../src/domain/ted-criteria.js';
import type { AnalysisData } from '../src/models/Analysis.js';

const run = {
  inputSnapshot: {
    B1: 'ปัญหาของลูกค้า',
    C2: 'มีต้นแบบ ทดสอบภายใน',
    G: 'ยังไม่มีผลทดลองกับผู้ใช้',
  },
  eligibility: evaluate({ A5: 1, thaiShares: 0, trlNumeric: 9 }, '2026-11-06'),
  tedCriteriaSnapshot: structuredClone(tedCriteria),
  groupContext: { group: null, status: 'unknown', warnings: [] },
} as unknown as AnalysisData;
const result = {
  summary: 'มีต้นแบบและต้องตรวจสอบตลาดเพิ่มเติม',
  tedAssessment: {
    developmentStage: {
      stage: 'EARLY_EVIDENCE',
      reason: 'มีการรายงานต้นแบบทดสอบภายใน แต่ยังต้องตรวจรายละเอียดผลทดสอบ',
      evidenceRefs: ['C2'],
    },
    classification: 'TED_IDEA',
    reason: 'มีปัญหาและแนวคิดที่ต้องพิสูจน์ตลาด',
    alternativeReason: 'ยังไม่มีผลตลาดรองรับเส้นทางเชิงพาณิชย์',
    evidenceRefs: ['B1', 'C2', 'G'],
    uncertainties: ['ต้องตรวจรายละเอียดการทดสอบ'],
  },
  programRecommendations: [],
  expertRecommendations: [],
  missingInformation: [],
};
describe('qualitative TED contract', () => {
  it.each(['TED_IDEA', 'TED_POC'])(
    'allows %s despite retired gates',
    (classification) => {
      expect(
        validateAiResult(
          {
            ...result,
            tedAssessment: {
              developmentStage: {
                stage: 'EARLY_EVIDENCE',
                reason:
                  'มีการรายงานต้นแบบทดสอบภายใน แต่ยังต้องตรวจรายละเอียดผลทดสอบ',
                evidenceRefs: ['C2'],
              },
              ...result.tedAssessment,
              classification,
            },
          },
          run,
        ).tedAssessment?.classification,
      ).toBe(classification);
    },
  );
  it('cannot silently accept a legacy response without TED assessment', () => {
    const { tedAssessment: _removed, ...legacy } = result;
    expect(() => validateAiResult(legacy, run)).toThrow();
  });
  it.each([
    { classification: 'TED_BOTH' },
    { evidenceRefs: [] },
    { evidenceRefs: ['unknown'] },
    { evidenceRefs: ['B2'] },
    { uncertainties: 'ไม่ชัด' },
    { reason: '' },
    { score: 90 },
  ])('rejects unsupported or malformed assessment %j', (change) => {
    expect(() =>
      validateAiResult(
        { ...result, tedAssessment: { ...result.tedAssessment, ...change } },
        run,
      ),
    ).toThrow();
  });
  it('rejects root-level scores and duplicate TED recommendation paths', () => {
    expect(() => validateAiResult({ ...result, score: 90 }, run)).toThrow();
    expect(() =>
      validateAiResult(
        {
          ...result,
          programRecommendations: [
            { program: 'TED_POC', reason: 'เสนอซ้ำ', evidenceRefs: ['B1'] },
          ],
        },
        run,
      ),
    ).toThrow();
  });
  it('allows genuinely empty input only as insufficient, with questions and limitations', () => {
    const empty = { ...run, inputSnapshot: {} };
    const insufficient = {
      ...result,
      tedAssessment: {
        developmentStage: {
          stage: 'EARLY_EVIDENCE',
          reason: 'มีการรายงานต้นแบบทดสอบภายใน แต่ยังต้องตรวจรายละเอียดผลทดสอบ',
          evidenceRefs: ['C2'],
        },
        ...result.tedAssessment,
        classification: 'INSUFFICIENT_DATA',
        developmentStage: {
          stage: 'UNCLEAR',
          reason: 'ยังไม่มีข้อมูลพัฒนา',
          evidenceRefs: [],
        },
        evidenceRefs: [],
      },
      missingInformation: ['ขอรายละเอียดปัญหา ผลิตภัณฑ์ และผลทดสอบตลาด'],
    };
    expect(
      validateAiResult(insufficient, empty).tedAssessment?.classification,
    ).toBe('INSUFFICIENT_DATA');
    expect(() =>
      validateAiResult({ ...insufficient, missingInformation: [] }, empty),
    ).toThrow();
    expect(() =>
      validateAiResult(
        {
          ...insufficient,
          tedAssessment: {
            developmentStage: {
              stage: 'EARLY_EVIDENCE',
              reason:
                'มีการรายงานต้นแบบทดสอบภายใน แต่ยังต้องตรวจรายละเอียดผลทดสอบ',
              evidenceRefs: ['C2'],
            },
            ...insufficient.tedAssessment,
            uncertainties: [],
          },
        },
        empty,
      ),
    ).toThrow();
    expect(() => validateAiResult(result, empty)).toThrow();
  });
  it('sends snapshotted criteria, never old TED gates or scoring fields', () => {
    const input = JSON.parse(buildAnalysisInput(run));
    expect(input.tedCriteria).toEqual({
      version: run.tedCriteriaSnapshot!.version,
      ...run.tedCriteriaSnapshot!.aiReference,
    });
    expect(
      input.fieldDefinitions.map((f: { id: string }) => f.id),
    ).not.toContain('trlNumeric');
    expect(
      input.fieldDefinitions.map((f: { id: string }) => f.id),
    ).not.toContain('thaiShares');
    expect(
      input.tedCriteria.programs.flatMap(
        (p: { domains: unknown[] }) => p.domains,
      ),
    ).toHaveLength(10);
    expect(
      input.deterministicEligibility.map((p: { program: string }) => p.program),
    ).toEqual(['UBI_PRE', 'UBI_STARTUP', 'TBI']);
    expect(JSON.stringify(input.tedCriteria)).not.toContain('"score":');
    expect(() =>
      buildAnalysisInput({ ...run, tedCriteriaSnapshot: undefined }),
    ).toThrow();
  });
});
