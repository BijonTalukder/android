import type { Types } from "mongoose";
import type { OrganizationSettings } from "@/models/Organization";
import type { OrganizationStatus } from "@/types";

export type OrganizationDto = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  settings: OrganizationSettings;
  createdAt: string;
  updatedAt: string;
};

type OrgLike = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  status: OrganizationStatus;
  settings?: OrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
};

export function toOrganizationDto(org: OrgLike): OrganizationDto {
  return {
    id: String(org._id),
    name: org.name,
    slug: org.slug,
    status: org.status,
    settings: org.settings ?? { smsEnabled: false },
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}
