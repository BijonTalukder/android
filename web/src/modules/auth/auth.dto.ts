import type { Types } from "mongoose";
import type { Role, UserStatus } from "@/types";

export type SessionUserDto = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  organizationId: string | null;
  organization: { id: string; name: string; slug: string } | null;
  lastLoginAt: string | null;
  createdAt: string;
};

type UserLike = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  organizationId: Types.ObjectId | null;
  lastLoginAt?: Date | null;
  createdAt: Date;
};

type OrgLike = { _id: Types.ObjectId; name: string; slug: string } | null;

export function toSessionUserDto(user: UserLike, organization: OrgLike): SessionUserDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    organizationId: user.organizationId ? String(user.organizationId) : null,
    organization: organization
      ? {
          id: String(organization._id),
          name: organization.name,
          slug: organization.slug,
        }
      : null,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}
