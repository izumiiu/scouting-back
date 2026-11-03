import { Schema, model, Types } from 'mongoose';
import type {
  Answers,
  AiSuggestion,
  Eligibility,
  GroupContext,
} from '../domain/types.js';
export interface AnalysisData {
  caseId: Types.ObjectId;
  organizationId: string;
  inputRevision: number;
  inputSnapshot: Answers;
  referenceDate: string;
  eligibility: Eligibility[];
  groupContext: GroupContext;
  ruleVersion: string;
  expertVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result: AiSuggestion | null;
  error: string | null;
  requestedBy: Types.ObjectId;
  idempotencyKey: string;
  leaseUntil: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  providerRequestId: string | null;
}
const schema = new Schema<AnalysisData>(
  {
    caseId: { type: Schema.Types.ObjectId, required: true },
    organizationId: { type: String, required: true },
    inputRevision: { type: Number, required: true },
    inputSnapshot: { type: Schema.Types.Mixed, required: true },
    referenceDate: { type: String, required: true },
    eligibility: { type: Schema.Types.Mixed, required: true },
    groupContext: { type: Schema.Types.Mixed, required: true },
    ruleVersion: String,
    expertVersion: String,
    promptVersion: String,
    provider: String,
    model: String,
    status: {
      type: String,
      enum: ['queued', 'running', 'succeeded', 'failed'],
      default: 'queued',
    },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    idempotencyKey: { type: String, required: true },
    leaseUntil: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    providerRequestId: { type: String, default: null },
  },
  { timestamps: true, minimize: false },
);
schema.index({ caseId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ organizationId: 1, caseId: 1, _id: -1 });
schema.index({ status: 1, leaseUntil: 1, createdAt: 1 });
export const Analysis = model<AnalysisData>('Analysis', schema);
