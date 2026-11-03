import { Schema, model, Types } from 'mongoose';
import type { CaseInput } from '../domain/types.js';
export interface CaseData {
  code: string;
  organizationId: string;
  input: CaseInput;
  titleSearch: string;
  revision: number;
  decisionVersion: number;
  activeAnalysisId: Types.ObjectId | null;
  latestAnalysisId: Types.ObjectId | null;
  lastReviewAnalysisId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  createKey: string;
  createHash: string;
}
const schema = new Schema<CaseData>(
  {
    code: { type: String, required: true, unique: true },
    organizationId: { type: String, required: true },
    input: { type: Schema.Types.Mixed, required: true },
    titleSearch: { type: String, required: true },
    revision: { type: Number, default: 1 },
    decisionVersion: { type: Number, default: 0 },
    activeAnalysisId: { type: Schema.Types.ObjectId, default: null },
    latestAnalysisId: { type: Schema.Types.ObjectId, default: null },
    lastReviewAnalysisId: { type: Schema.Types.ObjectId, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createKey: { type: String, required: true },
    createHash: { type: String, required: true },
  },
  { timestamps: true, minimize: false },
);
schema.index({ organizationId: 1, _id: -1 });
schema.index({ organizationId: 1, titleSearch: 1 });
schema.index(
  { organizationId: 1, createdBy: 1, createKey: 1 },
  { unique: true },
);
export const ScoutingCase = model<CaseData>('ScoutingCase', schema);
