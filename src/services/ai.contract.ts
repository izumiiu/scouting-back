import type { AiSuggestion } from '../domain/types.js';
import type { AnalysisData } from '../models/Analysis.js';

export type AiProviderId = 'openai' | 'groq';
export type AiProviderName = 'OpenAI' | 'Groq';

export interface AiProvider {
  readonly name: AiProviderName;
  analyze(
    run: AnalysisData,
  ): Promise<{ result: AiSuggestion; requestId: string | null }>;
}
