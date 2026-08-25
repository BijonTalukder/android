import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * Short-lived, admin-issued code that lets an unknown Android install claim a
 * device slot in one organization. Only the SHA-256 of the code is stored.
 */
export type EnrollmentTokenAttrs = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  tokenHash: string;
  /** First group of the code, kept in clear so admins can identify it in a list. */
  tokenPreview: string;
  deviceNameHint: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdBy: Types.ObjectId;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const enrollmentTokenSchema = new Schema<EnrollmentTokenAttrs>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    tokenHash: { type: String, required: true },
    tokenPreview: { type: String, required: true, maxlength: 16 },
    deviceNameHint: { type: String, default: null, trim: true, maxlength: 120 },
    maxUses: { type: Number, required: true, min: 1, max: 500, default: 1 },
    usedCount: { type: Number, required: true, min: 0, default: 0 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

enrollmentTokenSchema.index({ tokenHash: 1 }, { unique: true });
enrollmentTokenSchema.index({ organizationId: 1, createdAt: -1 });
// Purge a week after expiry: the audit log keeps the durable record.
enrollmentTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 604_800 });

export const EnrollmentToken: Model<EnrollmentTokenAttrs> =
  (models.EnrollmentToken as Model<EnrollmentTokenAttrs>) ??
  model<EnrollmentTokenAttrs>("EnrollmentToken", enrollmentTokenSchema);
