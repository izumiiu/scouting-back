import type { Config } from '../config/env.js';
import type { AiProvider } from './ai.contract.js';
import { GroqProvider } from './groq.service.js';
import { OpenAiProvider } from './openai.service.js';

export function createAiProvider(config: Config): AiProvider {
  return config.aiProvider === 'groq'
    ? new GroqProvider(config)
    : new OpenAiProvider(config);
}
