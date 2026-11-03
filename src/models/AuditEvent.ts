import { Schema, model, Types } from 'mongoose';
export interface AuditData {
  caseId: Types.ObjectId;
  organizationId: string;
  actor: Types.ObjectId;
  actorName: string;
  action: string;
  revision: number;
  details: unknown;
  createdAt: Date;
}
const schema = new Schema<AuditData>(
  {
    caseId: Schema.Types.ObjectId,
    organizationId: String,
    actor: Schema.Types.ObjectId,
    actorName: String,
    action: String,
    revision: Number,
    details: Schema.Types.Mixed,
  },
  { timestamps: true },
);
schema.index({ organizationId: 1, caseId: 1, _id: -1 });
export const AuditEvent = model<AuditData>('AuditEvent', schema);
