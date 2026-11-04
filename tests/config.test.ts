import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const environment = {
  MONGODB_URI: 'mongodb://localhost/scouting-test',
  JWT_SECRET: 'test-config-value-at-least-32-characters',
  OPENAI_API_KEY: 'openai-fixture',
  OPENAI_MODEL: 'openai-model-fixture',
  GROQ_API_KEY: 'groq-fixture',
  GROQ_MODEL: 'groq-model-fixture',
};
describe('provider credential isolation', () => {
  it('preserves existing OpenAI selection when no provider is set', () => {
    expect(loadConfig(environment)).toMatchObject({
      aiProvider: 'openai',
      aiKey: 'openai-fixture',
      aiModel: 'openai-model-fixture',
    });
  });
  it('uses only the selected Groq credentials', () => {
    expect(loadConfig({ ...environment, AI_PROVIDER: 'groq' })).toMatchObject({
      aiProvider: 'groq',
      aiKey: 'groq-fixture',
      aiModel: 'groq-model-fixture',
    });
  });
  it('never falls back to an OpenAI key or model when Groq configuration is missing', () => {
    expect(
      loadConfig({
        ...environment,
        AI_PROVIDER: 'groq',
        GROQ_API_KEY: '',
        GROQ_MODEL: '',
      }),
    ).toMatchObject({ aiKey: '', aiModel: '' });
  });
  it('rejects unrecognized providers rather than silently sending to another service', () => {
    expect(() => loadConfig({ ...environment, AI_PROVIDER: 'other' })).toThrow(
      'AI_PROVIDER',
    );
  });
});
