import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * One document per issued refresh token. Rotation writes a new document and
 * marks the old one revoked with a `replacedBy` pointer, which makes replay of
 * a stolen token detectable: a revoked-but-reused token means the whole chain
 * should be killed.
 */
export type RefreshTokenAttrs = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Stable id shared by every token in one rotation chain (the "session"). */
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const refreshTokenSchema = new Schema<RefreshTokenAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 400 },
    ip: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: true, versionKey: false },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
// Let MongoDB reap expired tokens; keep them a day past expiry for forensics.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const RefreshToken: Model<RefreshTokenAttrs> =
  (models.RefreshToken as Model<RefreshTokenAttrs>) ??
  model<RefreshTokenAttrs>("RefreshToken", refreshTokenSchema);
