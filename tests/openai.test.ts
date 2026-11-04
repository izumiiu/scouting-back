import { describe, it, expect } from 'vitest';
import { OpenAiProvider } from '../src/services/openai.service.js';
import type { Config } from '../src/config/env.js';
import type { AnalysisData } from '../src/models/Analysis.js';
import { evaluate } from '../src/domain/eligibility.js';
const config: Config = {
  port: 4000,
  mongoUri: '',
  jwtSecret: 'test-configuration-not-used-for-auth',
  origin: 'http://localhost',
  production: false,
  trustProxyHops: 0,
  aiProvider: 'openai',
  aiKey: 'fixture-not-real',
  aiModel: 'fixture-only',
  frontendDist: '',
  workerEnabled: false,
};
const run = {
  provider: 'OpenAI',
  model: 'fixture-only',
  inputSnapshot: { B1: 'ต้องการตลาด' },
  eligibility: evaluate({}, '2026-11-03'),
  groupContext: { group: null, status: 'unknown', warnings: [] },
} as unknown as AnalysisData;
const result = {
  summary: 'ข้อความทดสอบจาก transport fixture',
  programRecommendations: [],
  expertRecommendations: [
    {
      area: 'MARKETING',
      need: 'หาตลาด',
      reason: 'ระบุความต้องการตลาด',
      evidenceRefs: ['B1'],
    },
  ],
  missingInformation: [],
};
describe('OpenAI Responses transport without real network calls', () => {
  it('sends schema-constrained request and parses completed output_text', async () => {
    let payload: Record<string, unknown> = {};
    const transport: typeof fetch = async (_url, options) => {
      payload = JSON.parse(String(options?.body));
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [{ type: 'output_text', text: JSON.stringify(result) }],
            },
          ],
        }),
        { headers: { 'x-request-id': 'fixture-request' } },
      );
    };
    const response = await new OpenAiProvider(config, transport).analyze(run);
    expect(response.result).toEqual(result);
    expect(response.requestId).toBe('fixture-request');
    expect(payload.store).toBe(false);
    expect(payload.text).toMatchObject({
      format: { type: 'json_schema', strict: true },
    });
    expect(String(payload.input)).not.toContain('contactName');
    expect(String(payload.input)).toContain('fieldDefinitions');
  });
  it('rejects incomplete output instead of parsing partial JSON as success', async () => {
    const transport: typeof fetch = async () =>
      new Response(JSON.stringify({ status: 'incomplete', output: [] }));
    await expect(
      new OpenAiProvider(config, transport).analyze(run),
    ).rejects.toMatchObject({ code: 'AI_INCOMPLETE' });
  });
  it('redacts upstream authentication/provider response bodies', async () => {
    const transport: typeof fetch = async () =>
      new Response('SENSITIVE UPSTREAM BODY', { status: 401 });
    await expect(
      new OpenAiProvider(config, transport).analyze(run),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
  });
  it('turns timeout/network failure into a safe actionable error', async () => {
    const transport: typeof fetch = async () => {
      throw new Error('secret request headers');
    };
    await expect(
      new OpenAiProvider(config, transport).analyze(run),
    ).rejects.toMatchObject({ code: 'AI_CONNECTION_FAILED' });
  });
});
