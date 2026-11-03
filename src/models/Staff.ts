import { Schema, model } from 'mongoose';
export interface StaffData {
  email: string;
  name: string;
  passwordHash: string;
  organizationId: string;
  active: boolean;
  tokenVersion: number;
}
const schema = new Schema<StaffData>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    organizationId: { type: String, required: true, index: true },
    active: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const Staff = model<StaffData>('Staff', schema);
