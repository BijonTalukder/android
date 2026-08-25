import { Schema, model, models, type Model, type HydratedDocument, type Types } from "mongoose";
import { ORGANIZATION_STATUS_VALUES, type OrganizationStatus } from "@/types";

/** Per-tenant tunables. Fall back to the platform defaults when unset. */
export type OrganizationSettings = {
  offlineThresholdSeconds?: number;
  pollingIntervalSeconds?: number;
  heartbeatIntervalSeconds?: number;
  /** Tenant-level SEND_SMS switch. ANDed with the platform-wide switch. */
  smsEnabled: boolean;
};

export type OrganizationAttrs = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  status: OrganizationStatus;
  settings: OrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationDocument = HydratedDocument<OrganizationAttrs>;

const settingsSchema = new Schema<OrganizationSettings>(
  {
    offlineThresholdSeconds: { type: Number, min: 30, max: 86_400 },
    pollingIntervalSeconds: { type: Number, min: 5, max: 3_600 },
    heartbeatIntervalSeconds: { type: Number, min: 15, max: 3_600 },
    smsEnabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const organizationSchema = new Schema<OrganizationAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 60,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    status: {
      type: String,
      enum: ORGANIZATION_STATUS_VALUES,
      default: "ACTIVE",
      required: true,
    },
    settings: { type: settingsSchema, default: () => ({ smsEnabled: false }) },
  },
  { timestamps: true, versionKey: false },
);

organizationSchema.index({ slug: 1 }, { unique: true });
organizationSchema.index({ status: 1, createdAt: -1 });

export const Organization: Model<OrganizationAttrs> =
  (models.Organization as Model<OrganizationAttrs>) ??
  model<OrganizationAttrs>("Organization", organizationSchema);
