import { Schema, model, models, type Model, type Types } from "mongoose";
import { ACTOR_TYPE_VALUES, type ActorType } from "@/types";

/**
 * Who did what, to which resource. Distinct from `DeviceLog`, which records
 * what a device reported about itself.
 */
export type AuditLogAttrs = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId | null;
  actorType: ActorType;
  actorId: Types.ObjectId | null;
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: Types.ObjectId | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;
};

const auditLogSchema = new Schema<AuditLogAttrs>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    actorType: { type: String, enum: ACTOR_TYPE_VALUES, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorLabel: { type: String, default: null, maxlength: 254 },
    action: { type: String, required: true, maxlength: 120 },
    targetType: { type: String, default: null, maxlength: 60 },
    targetId: { type: Schema.Types.ObjectId, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog: Model<AuditLogAttrs> =
  (models.AuditLog as Model<AuditLogAttrs>) ??
  model<AuditLogAttrs>("AuditLog", auditLogSchema);
