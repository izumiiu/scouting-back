import type { Config } from '../config/env.js';
import type { AnalysisData } from '../models/Analysis.js';
import { AppError } from '../utils/errors.js';
import type {
  AiProvider,
  AiProviderId,
  AiProviderName,
} from './ai.contract.js';
import {
  analysisInstructions,
  buildAnalysisSchema,
  buildAnalysisInput,
  validateAiResult,
} from './ai-analysis.js';

const endpoints = {
  openai: 'https://api.openai.com/v1/responses',
  groq: 'https://api.groq.com/openai/v1/responses',
} as const;

/** Fixed endpoints prevent configuration from redirecting keys to another host. */
export class ResponsesProvider implements AiProvider {
  readonly name: AiProviderName;
  constructor(
    private config: Config,
    private id: AiProviderId,
    private transport: typeof fetch = fetch,
  ) {
    if (config.aiProvider !== id)
      throw new Error('AI provider configuration does not match the adapter');
    this.name = id === 'groq' ? 'Groq' : 'OpenAI';
  }

  async analyze(run: AnalysisData) {
    if (!this.config.aiKey || !this.config.aiModel)
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        `ยังไม่ได้ตั้ง API key และ model ของ ${this.name} ที่ backend`,
      );
    if (run.provider !== this.name || !run.model?.trim())
      throw new AppError(
        409,
        'AI_PROVIDER_CHANGED',
        'ผู้ให้บริการ AI ของงานไม่ตรงกับระบบ กรุณาสั่งวิเคราะห์ใหม่',
      );
    let response: Response;
    try {
      response = await this.transport(endpoints[this.id], {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.aiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Preserve the model captured when queued across configuration changes.
          model: run.model,
          ...(this.id === 'openai' ? { store: false } : {}),
          ...(this.id === 'groq' &&
          /^openai\/gpt-oss-(20b|120b)$/.test(run.model)
            ? { reasoning: { effort: 'low' } }
            : {}),
          instructions: analysisInstructions,
          input: buildAnalysisInput(run),
          max_output_tokens: 3500,
          text: {
            format: {
              type: 'json_schema',
              name: 'scouting_analysis',
              strict: true,
              schema: buildAnalysisSchema(run),
            },
          },
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new AppError(
        502,
        'AI_CONNECTION_FAILED',
        `เชื่อมต่อ ${this.name} ไม่สำเร็จหรือหมดเวลา โปรดลองใหม่ภายหลัง`,
      );
    }
    if (!response.ok)
      throw new AppError(
        502,
        'AI_PROVIDER_ERROR',
        response.status === 429
          ? `${this.name} จำกัดคำขอหรือโควตาไม่พอ กรุณาตรวจโควตาและลองใหม่ภายหลัง`
          : `${this.name} ไม่สามารถประมวลผลคำขอนี้ได้ กรุณาตรวจ key สิทธิ์โมเดล และการตั้งค่า`,
      );
    let body: {
      id?: string;
      status?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    try {
      body = await response.json();
    } catch {
      throw new AppError(
        502,
        'INVALID_AI_OUTPUT',
        'บริการ AI ส่งผลในรูปแบบที่อ่านไม่ได้',
      );
    }
    if (!body || body.status !== 'completed')
      throw new AppError(
        502,
        'AI_INCOMPLETE',
        `${this.name} ส่งผลไม่ครบหรือไม่สามารถตอบได้`,
      );
    if (!Array.isArray(body.output))
      throw new AppError(
        502,
        'INVALID_AI_OUTPUT',
        'บริการ AI ไม่ได้ส่งผลวิเคราะห์ที่อ่านได้',
      );
    const chunks = body.output.flatMap((x) =>
      Array.isArray(x?.content) ? x.content : [],
    );
    if (chunks.some((c) => c?.type === 'refusal'))
      throw new AppError(
        502,
        'AI_REFUSED',
        'AI ไม่สามารถวิเคราะห์ข้อมูลชุดนี้ได้ กรุณาตรวจทานข้อมูล',
      );
    const content = chunks
      .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AppError(
        502,
        'INVALID_AI_OUTPUT',
        'ผล AI ไม่อยู่ในรูปแบบที่อ่านได้',
      );
    }
    return {
      result: validateAiResult(parsed, run),
      requestId:
        response.headers.get('x-request-id') ??
        (typeof body.id === 'string' ? body.id : null),
    };
  }
}
