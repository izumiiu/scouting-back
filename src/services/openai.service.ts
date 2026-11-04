import type { Config } from '../config/env.js';
import { ResponsesProvider } from './responses.provider.js';

export class OpenAiProvider extends ResponsesProvider {
  constructor(config: Config, transport: typeof fetch = fetch) {
    super(config, 'openai', transport);
  }
}
