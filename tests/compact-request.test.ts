import { describe, it, expect, vi } from 'vitest';
import {
  buildAnalysisInput,
  buildAnalysisSchema,
} from '../src/services/ai-analysis.js';
import { tedCriteria } from '../src/domain/ted-criteria.js';
import { evaluate } from '../src/domain/eligibility.js';
import { GroqProvider } from '../src/services/groq.service.js';
import type { AnalysisData } from '../src/models/Analysis.js';
import type { Config } from '../src/config/env.js';

const answers = {
  C1: 'โครงการตัวอย่าง',
  C2: 'มีต้นแบบ ทดสอบภายใน',
  D5: 'มีงบเอง',
};
const run = {
  provider: 'Groq',
  model: 'fixture-model',
  inputSnapshot: answers,
  eligibility: evaluate(answers, '2026-11-06'),
  tedCriteriaSnapshot: structuredClone(tedCriteria),
  groupContext: { group: null, status: 'unknown', warnings: [] },
} as unknown as AnalysisData;
describe('compact provider request without loss of entrepreneur data', () => {
  it('preserves every answer exactly, including long Unicode text, arrays, null, zero and false', () => {
    const snapshot = {
      B1: 'หลักฐานทดสอบจริง ห้ามตัดคำตอบ '.repeat(1800),
      D1: 'ข้อมูลท้ายคำตอบที่ต้องคงไว้',
      F1: ['แหล่งทุน'],
      zero: 0,
      flag: false,
      empty: null,
      whitespace: '',
    };
    const payload = JSON.parse(
      buildAnalysisInput({ ...run, inputSnapshot: snapshot }),
    );
    expect(payload.answers).toEqual(snapshot);
    expect(payload.availableEvidenceRefs).toEqual([
      'B1',
      'D1',
      'F1',
      'zero',
      'flag',
    ]);
    expect(payload.answers.B1.endsWith('หลักฐานทดสอบจริง ห้ามตัดคำตอบ ')).toBe(
      true,
    );
  });
  it('only sends field definitions for populated evidence while retaining the full snapshot locally', () => {
    const payload = JSON.parse(buildAnalysisInput(run));
    expect(payload.fieldDefinitions.map((f: { id: string }) => f.id)).toEqual([
      'C1',
      'C2',
      'D5',
    ]);
    expect(payload.tedCriteria.source).toBeUndefined();
    expect(run.tedCriteriaSnapshot?.source).toBeTruthy();
    expect(run.tedCriteriaSnapshot?.programs[0]?.domains[0]?.label).toBe(
      'คุณภาพของปัญหาและโอกาส',
    );
  });
  it('keeps all 5 IDEA / 5 POC domains and 13 / 14 subcriteria aligned with the Thai source', () => {
    const compact = tedCriteria.aiReference!;
    expect(compact.sourceVersion).toBe(tedCriteria.version);
    expect(compact.programs.map((p) => p.program)).toEqual(
      tedCriteria.programs.map((p) => p.program),
    );
    for (const [i, program] of compact.programs.entries()) {
      expect(program.domains).toHaveLength(5);
      expect(program.domains.map((d) => d.considerations.length)).toEqual(
        tedCriteria.programs[i]!.domains.map((d) => d.considerations.length),
      );
      expect(program.domains.flatMap((d) => d.considerations)).toHaveLength(
        i === 0 ? 13 : 14,
      );
    }
    expect(compact.stageGuidance).toHaveLength(6);
    expect(compact.fundingGuidance).toContain('>=10%');
    expect(JSON.stringify(compact)).toContain('6-month');
    expect(JSON.stringify(compact)).toContain('2-year');
    expect(JSON.stringify(compact)).toContain(
      'existing revenue is not required',
    );
  });
  it('retains UBI/TBI outcomes and full local rules without repeating them in the provider request', () => {
    const payload = JSON.parse(buildAnalysisInput(run));
    expect(payload.deterministicEligibility).toEqual(
      run.eligibility
        .filter((p) => !p.program.startsWith('TED_'))
        .map(({ program, outcome }) => ({ program, outcome })),
    );
    expect(
      run.eligibility.find((p) => p.program === 'UBI_PRE')!.conditions.length,
    ).toBeGreaterThan(0);
    expect(payload.expertAreas).toContain('MARKETING');
    expect(payload.groupExpertAreas).toEqual([]);
  });
  it('rejects absent or mismatched compact references before any provider call', async () => {
    const transport = vi.fn<typeof fetch>();
    const config = {
      aiProvider: 'groq',
      aiKey: 'fixture-not-real',
      aiModel: 'fixture-model',
    } as Config;
    for (const snapshot of [
      undefined,
      { ...tedCriteria, aiReference: undefined },
      {
        ...tedCriteria,
        aiReference: {
          ...tedCriteria.aiReference!,
          sourceVersion: 'wrong-version',
        },
      },
    ]) {
      await expect(
        new GroqProvider(config, transport).analyze({
          ...run,
          tedCriteriaSnapshot: snapshot,
        }),
      ).rejects.toMatchObject({ code: 'AI_RULES_CHANGED' });
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('shares the populated evidence enum across all citations instead of duplicating it', () => {
    const schema = buildAnalysisSchema(run);
    expect(schema.$defs.evidenceRef.enum).toEqual(['C1', 'C2', 'D5']);
    for (const refs of [
      schema.properties.tedAssessment.properties.evidenceRefs,
      schema.properties.tedAssessment.properties.developmentStage.properties
        .evidenceRefs,
      schema.properties.programRecommendations.items.properties.evidenceRefs,
      schema.properties.expertRecommendations.items.properties.evidenceRefs,
    ]) {
      expect(refs.items).toEqual({ $ref: '#/$defs/evidenceRef' });
    }
  });
});
