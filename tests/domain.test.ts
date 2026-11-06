import { describe, it, expect } from 'vitest';
import { evaluate, ageOn, validDate } from '../src/domain/eligibility.js';
import { deriveGroup } from '../src/domain/grouping.js';
import { parseCaseInput } from '../src/validators/case.validator.js';
import { validateAiResult } from '../src/services/ai-analysis.js';
import type { Answers, CaseInput } from '../src/domain/types.js';
const input: CaseInput = {
  title: 'ทดสอบ',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  sourceChannel: 'แบบฟอร์ม',
  sourceReference: 'test',
  referenceDate: '2026-11-03',
  permissionStatus: 'unknown',
  permissionReference: '',
  allowAiProcessing: false,
  answers: {},
};
const outcome = (answers: Answers, code: string) =>
  evaluate(answers, '2026-11-03').find((x) => x.program === code)!.outcome;
describe('program criteria boundaries', () => {
  it('missing data stays unknown for all programs', () =>
    expect(
      evaluate({}, '2026-11-03').every((x) => x.outcome === 'unknown'),
    ).toBe(true));
  it.each([
    {},
    {
      A3: 'ผู้ประกอบการ',
      A5: 1,
      nationalityThai: 'ไม่ใช่',
      tedFellow: 'ไม่ใช่',
      trlNumeric: 9,
      trlVerified: 'ไม่ใช่',
    },
    {
      A6: 'ยังไม่จดทะเบียน',
      thaiShares: 0,
      studentShares: 0,
      authorizedDirector: 'ไม่ใช่',
    },
    {
      A3: 'ศิษย์เก่า',
      graduatedOn: '2000-01-01',
      trlNumeric: 1,
      trlVerified: 'ใช่',
    },
  ] as Answers[])('never applies retired TED gates to %j', (answers) => {
    for (const program of ['TED_IDEA', 'TED_POC']) {
      expect(
        evaluate(answers, '2026-11-06').find((p) => p.program === program),
      ).toMatchObject({
        assessmentMode: 'qualitative',
        outcome: 'unknown',
        conditions: [],
      });
    }
  });
  it('preserves UBI alumni anniversary, institution and MVP rules', () => {
    const answers = {
      A3: 'ศิษย์เก่า',
      graduatedOn: '2021-11-03',
      institution: 'มหาวิทยาลัยนเรศวร',
      A6: 'ยังไม่จดทะเบียน',
      mvpVerified: 'ใช่',
    };
    expect(outcome(answers, 'UBI_PRE')).toBe('pass');
    expect(outcome(answers, 'UBI_STARTUP')).toBe('pass');
    expect(outcome({ ...answers, graduatedOn: '2021-11-02' }, 'UBI_PRE')).toBe(
      'unknown',
    );
    expect(outcome({ ...answers, mvpVerified: 'ไม่ใช่' }, 'UBI_STARTUP')).toBe(
      'fail',
    );
  });
  it.each([
    [19, 'fail'],
    [20, 'pass'],
    [60, 'pass'],
    [61, 'fail'],
  ])('TBI declared age %s => %s', (age, expected) =>
    expect(
      outcome(
        {
          A4: age,
          A6: 'นิติบุคคล',
          registeredOn: '2024-01-01',
          previousNetwork: 'ไม่เคย',
        },
        'TBI',
      ),
    ).toBe(expected),
  );
  it('known failure remains failure while other fields unknown', () =>
    expect(outcome({ A4: 19 }, 'TBI')).toBe('fail'));
  it('birth dates use completed age at reference date', () => {
    expect(ageOn('2006-11-03', '2026-11-03')).toBe(20);
    expect(ageOn('2006-11-04', '2026-11-03')).toBe(19);
  });
});
describe('reference ambiguity and validation', () => {
  it('does not turn unverified bands into numeric TRL/group', () =>
    expect(
      deriveGroup({
        originType: 'ก: เทคโนโลยี/ไอเดีย',
        trlBand: 'พร้อม',
        crlBand: 'กลาง',
      }).group,
    ).toBeNull());
  it('confirmed early band yields stage 1', () =>
    expect(
      deriveGroup({
        originType: 'ก: เทคโนโลยี/ไอเดีย',
        trlBand: 'ต้น',
        crlBand: 'พร้อม',
        bandsVerified: 'ใช่',
      }).group,
    ).toBe('ก-1'));
  it('conflicting SME cost-low group stays pending', () =>
    expect(
      deriveGroup({
        originType: 'ข: ตลาด',
        trlBand: 'พร้อม',
        crlBand: 'กลาง',
        brlBand: 'ต้น',
        bandsVerified: 'ใช่',
      }).group,
    ).toBeNull());
  it('stage 3 historical prerequisite remains unresolved', () =>
    expect(
      deriveGroup({
        originType: 'ก: เทคโนโลยี/ไอเดีย',
        trlBand: 'พร้อม',
        crlBand: 'พร้อม',
        brlBand: 'กลาง',
        bandsVerified: 'ใช่',
      }).group,
    ).toBeNull());
  it('keeps zero distinct from null', () =>
    expect(
      parseCaseInput({ ...input, answers: { unitCost: 0, trlNumeric: null } })
        .answers.unitCost,
    ).toBe(0));
  it('rejects selector injection and unknown fields', () => {
    expect(() =>
      parseCaseInput({ ...input, answers: { A5: { $gte: 3 } } }),
    ).toThrow();
    expect(() =>
      parseCaseInput({ ...input, answers: { $where: 'x' } }),
    ).toThrow();
  });
  it('rejects fraction team size, out-of-range percentages, excess needs', () => {
    for (const answers of [
      { A5: 2.5 },
      { thaiShares: 101 },
      { D4: ['ยังไม่มี', 'แผนธุรกิจ'] },
      { E2: ['ยังไม่ได้ทำเพิ่ม', 'คุยลูกค้า'] },
      {
        F1: [
          'แหล่งทุน',
          'เครือข่าย/ตลาด',
          'ผู้เชี่ยวชาญ/นักวิจัย',
          'บรรจุภัณฑ์',
        ],
      },
    ])
      expect(() => parseCaseInput({ ...input, answers })).toThrow();
  });
  it('rejects impossible dates', () => {
    expect(validDate('2026-02-30')).toBe(false);
    expect(() =>
      parseCaseInput({ ...input, referenceDate: '2026-02-30' }),
    ).toThrow();
  });
  it('requires actual permission reference before external AI', () =>
    expect(() =>
      parseCaseInput({
        ...input,
        allowAiProcessing: true,
        permissionStatus: 'granted',
      }),
    ).toThrow());
});
describe('untrusted AI output', () => {
  const run = {
    inputSnapshot: { B1: 'ต้องการหาตลาด' },
    eligibility: evaluate({ A4: 19 }, '2026-11-03'),
  };
  const base = {
    tedAssessment: {
      developmentStage: {
        stage: 'UNCLEAR' as const,
        reason: 'ยังไม่มีรายละเอียดระยะพัฒนาเพียงพอ',
        evidenceRefs: ['B1'],
      },
      classification: 'INSUFFICIENT_DATA' as const,
      reason: 'มีเพียงข้อมูลความต้องการ ยังแยกประเภทไม่ได้',
      alternativeReason: 'ยังไม่มีข้อมูลพอเทียบแนวคิดกับการพิสูจน์เชิงพาณิชย์',
      evidenceRefs: ['B1'],
      uncertainties: ['ยังไม่ทราบผลพัฒนาผลิตภัณฑ์และหลักฐานตลาด'],
    },
    summary: 'สรุปจากข้อมูล',
    programRecommendations: [],
    expertRecommendations: [
      {
        area: 'MARKETING',
        need: 'หาลูกค้า',
        reason: 'ยังต้องการตลาด',
        evidenceRefs: ['B1'],
      },
    ],
    missingInformation: ['ขอผลทดสอบตลาดและสถานะผลิตภัณฑ์'],
  };
  it('allows expert advice while program eligibility incomplete', () =>
    expect(validateAiResult(base, run).expertRecommendations).toHaveLength(1));
  it('rejects unsupported evidence', () =>
    expect(() =>
      validateAiResult(
        {
          ...base,
          expertRecommendations: [
            { ...base.expertRecommendations[0], evidenceRefs: ['MADE_UP'] },
          ],
        },
        run,
      ),
    ).toThrow());
  it('rejects invented person/code', () =>
    expect(() =>
      validateAiResult(
        {
          ...base,
          expertRecommendations: [
            { ...base.expertRecommendations[0], area: 'PERSON_123' },
          ],
        },
        run,
      ),
    ).toThrow());
  it('rejects recommendations contradicting known failed criteria', () =>
    expect(() =>
      validateAiResult(
        {
          ...base,
          programRecommendations: [
            { program: 'TBI', reason: 'น่าสนใจ', evidenceRefs: ['B1'] },
          ],
        },
        run,
      ),
    ).toThrow());
  it('allows no recommendation when insufficient evidence', () =>
    expect(
      validateAiResult({ ...base, expertRecommendations: [] }, run)
        .expertRecommendations,
    ).toHaveLength(0));
});
