import { describe, it, expect } from 'vitest';
import { tedFundingReadiness } from '../src/domain/ted-readiness.js';
import {
  buildAnalysisSchema,
  validateAiResult,
  buildAnalysisInput,
} from '../src/services/ai-analysis.js';
import { tedCriteria } from '../src/domain/ted-criteria.js';
import { evaluate } from '../src/domain/eligibility.js';
import type { AnalysisData } from '../src/models/Analysis.js';

const answers = {
  C2: 'มีต้นแบบ ทดสอบกับผู้ใช้จริง',
  D1: 'ทดสอบกับผู้ใช้ 5 ราย',
  D2: 'ยังไม่มีรายได้',
  D5: 'ยังไม่ชัดเจน',
};
const run = {
  inputSnapshot: answers,
  eligibility: evaluate(answers, '2026-11-06'),
  tedCriteriaSnapshot: structuredClone(tedCriteria),
  groupContext: { group: null, status: 'unknown', warnings: [] },
} as unknown as AnalysisData;
const assessment = {
  developmentStage: {
    stage: 'WORKING_PROTOTYPE',
    reason: 'มีต้นแบบและผลการทดสอบที่ต้องให้เจ้าหน้าที่ตรวจ',
    evidenceRefs: ['C2', 'D1'],
  },
  classification: 'TED_POC',
  reason: 'หลักฐานต้นแบบและการทดลองใช้สนับสนุนการพัฒนาต่อสู่รายได้แรก',
  alternativeReason: 'มีหลักฐานพัฒนามากกว่าระยะแนวคิด',
  evidenceRefs: ['C2', 'D1'],
  uncertainties: ['ต้องตรวจรายละเอียดแผนรายได้แรก'],
};
const result = {
  tedAssessment: assessment,
  summary: 'ต้นแบบที่ยังไม่มีรายได้',
  programRecommendations: [],
  expertRecommendations: [],
  missingInformation: ['ขอแผนรายได้แรก'],
};

describe('separate stage/classification and POC contribution verification', () => {
  it.each([
    undefined,
    '',
    'มีงบเอง',
    'ร่วมลงทุนได้บางส่วน',
    'ต้องการแหล่งทุนทั้งหมด',
    'ยังไม่ชัดเจน',
  ])('never certifies 10%% or changes POC based on budget %s', (budget) => {
    const inputSnapshot = budget === undefined ? {} : { D5: budget };
    const readiness = tedFundingReadiness('TED_POC', inputSnapshot);
    expect(readiness.status).toBe('NEEDS_VERIFICATION');
    expect(readiness.evidenceRefs).toEqual(budget ? ['D5'] : []);
    const validated = validateAiResult(result, {
      ...run,
      inputSnapshot: { ...answers, ...inputSnapshot },
    });
    expect(validated.tedAssessment?.classification).toBe('TED_POC');
    expect(validated.tedAssessment?.fundingReadiness?.status).toBe(
      'NEEDS_VERIFICATION',
    );
  });
  it('does not infer verified contribution from an unverified free-text percentage', () => {
    expect(
      tedFundingReadiness('TED_POC', { D5: 'มีงบเอง', G: 'คาดว่าสมทบ 15% ได้' })
        .status,
    ).toBe('NEEDS_VERIFICATION');
  });
  it.each(['TED_IDEA', 'INSUFFICIENT_DATA'] as const)(
    'does not impose POC funding on %s',
    (classification) => {
      expect(tedFundingReadiness(classification, answers)).toMatchObject({
        status: 'NOT_ASSESSED',
        evidenceRefs: [],
      });
    },
  );
  it('keeps stage assessment without adding scores or automatic classification gates', () => {
    const validated = validateAiResult(result, run);
    expect(validated.tedAssessment?.developmentStage).toEqual(
      assessment.developmentStage,
    );
    expect(validated.tedAssessment?.classification).toBe('TED_POC');
    expect(result.tedAssessment).not.toHaveProperty('fundingReadiness');
    const mockup = {
      ...result,
      tedAssessment: {
        ...assessment,
        classification: 'TED_IDEA',
        reason: 'มีเพียงแบบร่างและต้องพิสูจน์การทำงาน',
        alternativeReason: 'ยังไม่มีหลักฐานต้นแบบทำงานได้',
        evidenceRefs: ['C2', 'G'],
        developmentStage: {
          stage: 'MOCKUP',
          reason: 'แบบจำลองยังไม่ทำงานจริง',
          evidenceRefs: ['C2'],
        },
      },
    };
    expect(
      validateAiResult(mockup, {
        ...run,
        inputSnapshot: { C2: 'มีแค่ไอเดีย', G: 'มีแบบร่างหน้าจอ' },
      }).tedAssessment?.developmentStage?.stage,
    ).toBe('MOCKUP');
  });
  it.each([
    undefined,
    { stage: 'TRL_5', reason: 'แปลงระดับเอง', evidenceRefs: ['C2'] },
    { stage: 'MOCKUP', reason: 'แบบร่าง', evidenceRefs: [] },
    {
      stage: 'WORKING_PROTOTYPE',
      reason: 'ต้นแบบ',
      evidenceRefs: ['not-provided'],
    },
    { stage: 'CONCEPT', reason: '', evidenceRefs: ['C2'] },
    { stage: 'CONCEPT', reason: 'แนวคิด', evidenceRefs: ['C2'], score: 10 },
  ])(
    'rejects missing, invented or malformed development stage %j',
    (developmentStage) => {
      expect(() =>
        validateAiResult(
          { ...result, tedAssessment: { ...assessment, developmentStage } },
          run,
        ),
      ).toThrow();
    },
  );
  it('records contradictions as unclear with citations rather than inventing a confirmed stage', () => {
    const contradictory = {
      ...run,
      inputSnapshot: { C2: 'มีแค่ไอเดีย', G: 'มีผลขายจริงแต่ไม่มีรายละเอียด' },
    };
    const raw = {
      ...result,
      tedAssessment: {
        ...assessment,
        classification: 'INSUFFICIENT_DATA',
        evidenceRefs: ['C2', 'G'],
        developmentStage: {
          stage: 'UNCLEAR',
          reason: 'ขั้นผลิตภัณฑ์ขัดกับสรุปหลักฐาน',
          evidenceRefs: ['C2', 'G'],
        },
      },
    };
    expect(
      validateAiResult(raw, contradictory).tedAssessment?.developmentStage
        ?.stage,
    ).toBe('UNCLEAR');
  });
  it('does not accept an AI-supplied funding certification', () => {
    expect(() =>
      validateAiResult(
        {
          ...result,
          tedAssessment: {
            ...assessment,
            fundingReadiness: { status: 'VERIFIED' },
          },
        },
        run,
      ),
    ).toThrow();
    expect(
      buildAnalysisSchema(run).properties.tedAssessment.properties,
    ).not.toHaveProperty('fundingReadiness');
  });
  it('includes stage and funding separation in the immutable criteria payload', () => {
    const payload = JSON.parse(buildAnalysisInput(run));
    expect(payload.tedCriteria.stageGuidance).toEqual(
      run.tedCriteriaSnapshot?.stageGuidance,
    );
    expect(payload.tedCriteria.fundingGuidance).toEqual(
      run.tedCriteriaSnapshot?.fundingGuidance,
    );
    expect(payload.tedCriteria.version).toBe(
      'ted-youth-startup-2026-11-06-qualitative-2',
    );
  });
});
