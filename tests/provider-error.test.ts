import { describe, it, expect } from 'vitest';
import { providerError } from '../src/services/provider-error.js';

describe('safe actionable provider errors', () => {
  it('distinguishes an oversized request from a temporary rate limit', async () => {
    const error = await providerError(
      new Response('secret upstream body org_private', { status: 413 }),
      'Groq',
    );
    expect(error.code).toBe('AI_REQUEST_TOO_LARGE');
    expect(error.message).toContain('การรอหรือกดซ้ำด้วยข้อมูลเดิมไม่ช่วย');
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('key');
  });
  it('only exposes a bounded numeric retry delay, never the raw provider response', async () => {
    const error = await providerError(
      new Response('secret body', {
        status: 429,
        headers: { 'retry-after': '9.2' },
      }),
      'Groq',
    );
    expect(error.code).toBe('AI_RATE_LIMITED');
    expect(error.message).toContain('10 วินาที');
    expect(error.message).not.toContain('secret');
  });
  it.each(['secret-key', '-5', 'Infinity', '900000', ''])(
    'rejects invalid retry-after %j',
    async (delay) => {
      const error = await providerError(
        new Response('secret', {
          status: 429,
          headers: { 'retry-after': delay },
        }),
        'Groq',
      );
      expect(error.code).toBe('AI_RATE_LIMITED');
      expect(error.message).not.toContain('วินาที');
      expect(error.message).not.toContain('secret');
    },
  );
  it('recognizes the schema error code without exposing failed_generation or message contents', async () => {
    const error = await providerError(
      new Response(
        JSON.stringify({
          error: {
            code: 'json_validate_failed',
            message: 'private',
            failed_generation: 'private output',
          },
        }),
        { status: 400 },
      ),
      'Groq',
    );
    expect(error.code).toBe('INVALID_AI_OUTPUT');
    expect(error.message).not.toContain('private');
  });
  it.each([400, 401, 403, 500])(
    'keeps status %i generic when no recognized safe detail exists',
    async (status) => {
      const error = await providerError(
        new Response('private provider detail', { status }),
        'Groq',
      );
      expect(error.code).toBe('AI_PROVIDER_ERROR');
      expect(error.message).not.toContain('private');
    },
  );
});
