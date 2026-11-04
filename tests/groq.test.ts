import { describe, it, expect, vi } from 'vitest';
import { GroqProvider } from '../src/services/groq.service.js';
import { createAiProvider } from '../src/services/ai-provider.factory.js';
import type { Config } from '../src/config/env.js';
import type { AnalysisData } from '../src/models/Analysis.js';
import { evaluate } from '../src/domain/eligibility.js';
import { buildAnalysisSchema } from '../src/services/ai-analysis.js';

const config: Config = {
  port: 4000,
  mongoUri: '',
  jwtSecret: 'fixture-not-for-auth',
  origin: 'http://localhost',
  production: false,
  trustProxyHops: 0,
  aiProvider: 'groq',
  aiKey: 'fixture-not-real',
  aiModel: 'different-current-model',
  frontendDist: '',
  workerEnabled: false,
};
const run = {
  provider: 'Groq',
  model: 'openai/gpt-oss-120b',
  inputSnapshot: { B1: 'ต้องการตลาด' },
  eligibility: evaluate({}, '2026-11-04'),
  groupContext: { group: null, status: 'unknown', warnings: [] },
} as unknown as AnalysisData;
const result = {
  summary: 'ผลจาก transport fixture เท่านั้น',
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
function completed(value: unknown = result) {
  return new Response(
    JSON.stringify({
      id: 'fixture-groq-response',
      status: 'completed',
      output: [
        {
          type: 'reasoning',
          content: [
            { type: 'reasoning_text', text: 'must not parse reasoning' },
          ],
        },
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(value) }],
        },
      ],
    }),
  );
}

describe('Groq adapter without real network calls', () => {
  it('uses Groq endpoint, queued model and strict schema while omitting unsupported store', async () => {
    const transport = vi.fn<typeof fetch>(async () => completed());
    const response = await new GroqProvider(config, transport).analyze(run);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/responses');
    expect(options?.headers).toMatchObject({
      Authorization: 'Bearer fixture-not-real',
    });
    const payload = JSON.parse(String(options?.body));
    expect(payload.model).toBe(run.model);
    expect(payload).not.toHaveProperty('store');
    expect(payload.reasoning).toEqual({ effort: 'low' });
    expect(payload.text.format).toMatchObject({
      type: 'json_schema',
      strict: true,
    });
    expect(payload.input).not.toContain('contactName');
    expect(
      payload.text.format.schema.properties.expertRecommendations.items
        .properties.evidenceRefs.items.enum,
    ).toEqual(['B1']);
    expect(JSON.parse(payload.input).availableEvidenceRefs).toEqual(['B1']);
    expect(response.result).toEqual(result);
    expect(response.requestId).toBe('fixture-groq-response');
  });
  it('rejects a narrative program decision in the descriptive summary', async () => {
    const transport: typeof fetch = async () =>
      completed({ ...result, summary: 'ผ่านเฉพาะ TED IDEA เท่านั้น' });
    await expect(
      new GroqProvider(config, transport).analyze(run),
    ).rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
  });
  it('limits evidence to populated answers, preserving meaningful zero and false', () => {
    const schema = buildAnalysisSchema({
      inputSnapshot: {
        B1: 'มีข้อมูล',
        D2: null,
        D3: '',
        D6: [],
        amount: 0,
        flag: false,
      },
    });
    expect(
      schema.properties.expertRecommendations.items.properties.evidenceRefs
        .items.enum,
    ).toEqual(['B1', 'amount', 'flag']);
    expect(
      schema.properties.programRecommendations.items.properties.evidenceRefs
        .items.enum,
    ).not.toContain('D2');
  });
  it('rejects invented evidence rather than persisting it as successful analysis', async () => {
    const transport: typeof fetch = async () =>
      completed({
        ...result,
        expertRecommendations: [
          {
            ...result.expertRecommendations[0],
            evidenceRefs: ['not-an-answer'],
          },
        ],
      });
    await expect(
      new GroqProvider(config, transport).analyze(run),
    ).rejects.toMatchObject({ code: 'INVALID_AI_OUTPUT' });
  });
  it('reports quota exhaustion safely and performs no automatic retry or fallback', async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response('private provider details', { status: 429 }),
    );
    await expect(
      new GroqProvider(config, transport).analyze(run),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      message: expect.stringContaining('Groq'),
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not forward raw authentication failures', async () => {
    const transport: typeof fetch = async () =>
      new Response('private key must not leak', { status: 401 });
    const error = await new GroqProvider(config, transport)
      .analyze(run)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    expect(String(error)).not.toContain('private key');
  });
  it.each([
    [
      'incomplete',
      () => new Response(JSON.stringify({ status: 'incomplete', output: [] })),
      'AI_INCOMPLETE',
    ],
    [
      'refusal',
      () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [{ content: [{ type: 'refusal' }] }],
          }),
        ),
      'AI_REFUSED',
    ],
    ['invalid JSON', () => new Response('not-json'), 'INVALID_AI_OUTPUT'],
  ])('rejects %s', async (_name, response, code) => {
    const transport: typeof fetch = async () => (response as () => Response)();
    await expect(
      new GroqProvider(config, transport).analyze(run),
    ).rejects.toMatchObject({ code });
  });
  it('does not call Groq with a run attributed to another provider', async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      new GroqProvider(config, transport).analyze({
        ...run,
        provider: 'OpenAI',
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_CHANGED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('requires the selected key and selects the matching adapter', async () => {
    expect(createAiProvider(config).name).toBe('Groq');
    expect(createAiProvider({ ...config, aiProvider: 'openai' }).name).toBe(
      'OpenAI',
    );
    const transport = vi.fn<typeof fetch>();
    await expect(
      new GroqProvider({ ...config, aiKey: '' }, transport).analyze(run),
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(transport).not.toHaveBeenCalled();
  });
});
