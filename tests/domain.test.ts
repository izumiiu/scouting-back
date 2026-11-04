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
const idea: Answers = {
  A3: 'นิสิต',
  nationalityThai: 'ใช่',
  A5: 3,
  trlNumeric: 2,
  trlVerified: 'ใช่',
  tedFellow: 'ใช่',
};
const poc: Answers = {
  A3: 'นิสิต',
  A6: 'นิติบุคคล',
  thaiShares: 51,
  studentShares: 31,
  authorizedDirector: 'ใช่',
  trlNumeric: 5,
  trlVerified: 'ใช่',
};
const outcome = (answers: Answers, code: string) =>
  evaluate(answers, '2026-11-03').find((x) => x.program === code)!.outcome;
describe('program criteria boundaries', () => {
  it('missing data stays unknown for all programs', () =>
    expect(
      evaluate({}, '2026-11-03').every((x) => x.outcome === 'unknown'),
    ).toBe(true));
  it.each([
    [1, 'fail'],
    [2, 'pass'],
    [4, 'pass'],
    [5, 'fail'],
  ])('IDEA numeric TRL %s => %s', (trl, expected) =>
    expect(outcome({ ...idea, trlNumeric: trl }, 'TED_IDEA')).toBe(expected),
  );
  it('team includes applicant and requires 3', () =>
    expect(outcome({ ...idea, A5: 2 }, 'TED_IDEA')).toBe('fail'));
  it('unverified numeric TRL cannot establish eligibility', () =>
    expect(outcome({ ...idea, trlVerified: 'ไม่ใช่' }, 'TED_IDEA')).toBe(
      'unknown',
    ));
  it.each([
    [30, 'fail'],
    [30.01, 'pass'],
  ])('POC student shares %s => %s', (shares, expected) =>
    expect(outcome({ ...poc, studentShares: shares }, 'TED_POC')).toBe(
      expected,
    ),
  );
  it('Thai shares 51 is inclusive', () =>
    expect(outcome(poc, 'TED_POC')).toBe('pass'));
  it('Thai shares below 51 fail', () =>
    expect(outcome({ ...poc, thaiShares: 50.99 }, 'TED_POC')).toBe('fail'));
  it.each([5, 8])('POC numeric TRL %s is inclusive', (trl) =>
    expect(outcome({ ...poc, trlNumeric: trl }, 'TED_POC')).toBe('pass'),
  );
  it('education 5-year anniversary inclusive; following day out', () => {
    expect(
      outcome(
        { ...idea, A3: 'ศิษย์เก่า', graduatedOn: '2021-11-03' },
        'TED_IDEA',
      ),
    ).toBe('pass');
    expect(
      outcome(
        { ...idea, A3: 'ศิษย์เก่า', graduatedOn: '2021-11-02' },
        'TED_IDEA',
      ),
    ).toBe('fail');
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
    expect(outcome({ thaiShares: 20 }, 'TED_POC')).toBe('fail'));
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
    eligibility: evaluate({ thaiShares: 1 }, '2026-11-03'),
  };
  const base = {
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
    missingInformation: [],
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
            { program: 'TED_POC', reason: 'น่าสนใจ', evidenceRefs: ['B1'] },
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
