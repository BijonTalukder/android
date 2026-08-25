import { Schema, model, models, type Model, type HydratedDocument, type Types } from "mongoose";
import { ROLE_VALUES, USER_STATUS_VALUES, type Role, type UserStatus } from "@/types";

export type UserAttrs = {
  _id: Types.ObjectId;
  /** null only for SUPER_ADMIN, who lives above every tenant. */
  organizationId: Types.ObjectId | null;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UserDocument = HydratedDocument<UserAttrs>;

const userSchema = new Schema<UserAttrs>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    // `select: false` keeps the hash out of every accidental read.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_VALUES, required: true },
    status: { type: String, enum: USER_STATUS_VALUES, default: "ACTIVE", required: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

// Email is the global login identifier, so uniqueness is platform-wide rather
// than per organization. A person who belongs to two tenants needs two logins.
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ organizationId: 1, role: 1 });
userSchema.index({ organizationId: 1, createdAt: -1 });

export const User: Model<UserAttrs> =
  (models.User as Model<UserAttrs>) ?? model<UserAttrs>("User", userSchema);
