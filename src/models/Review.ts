import { Schema, model, Types } from 'mongoose';
export interface ReviewData {
  caseId: Types.ObjectId;
  organizationId: string;
  analysisId: Types.ObjectId;
  inputRevision: number;
  decisionVersion: number;
  destination: string | null;
  expertAreas: string[];
  notes: string;
  reviewer: Types.ObjectId;
  reviewerName: string;
  idempotencyKey: string;
  payloadHash: string;
  createdAt: Date;
}
const schema = new Schema<ReviewData>(
  {
    caseId: Schema.Types.ObjectId,
    organizationId: String,
    analysisId: Schema.Types.ObjectId,
    inputRevision: Number,
    decisionVersion: Number,
    destination: { type: String, default: null },
    expertAreas: [String],
    notes: String,
    reviewer: Schema.Types.ObjectId,
    reviewerName: String,
    idempotencyKey: String,
    payloadHash: String,
  },
  { timestamps: true },
);
schema.index({ caseId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ organizationId: 1, caseId: 1, _id: -1 });
export const Review = model<ReviewData>('Review', schema);
