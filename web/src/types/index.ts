/**
 * Shared domain enums and types.
 *
 * Enums are declared as frozen const objects (not TS `enum`) so that the same
 * values can be reused directly by Zod schemas, Mongoose schemas and the
 * client bundle without duplication.
 */

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ORGANIZATION_ADMIN: "ORGANIZATION_ADMIN",
  ORGANIZATION_MEMBER: "ORGANIZATION_MEMBER",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];
export const ROLE_VALUES = Object.values(ROLES) as [Role, ...Role[]];

export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
export const USER_STATUS_VALUES = Object.values(USER_STATUS) as [UserStatus, ...UserStatus[]];

export const ORGANIZATION_STATUS = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type OrganizationStatus =
  (typeof ORGANIZATION_STATUS)[keyof typeof ORGANIZATION_STATUS];
export const ORGANIZATION_STATUS_VALUES = Object.values(ORGANIZATION_STATUS) as [
  OrganizationStatus,
  ...OrganizationStatus[],
];

export const DEVICE_STATUS = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  INACTIVE: "INACTIVE",
  BLOCKED: "BLOCKED",
} as const;
export type DeviceStatus = (typeof DEVICE_STATUS)[keyof typeof DEVICE_STATUS];
export const DEVICE_STATUS_VALUES = Object.values(DEVICE_STATUS) as [
  DeviceStatus,
  ...DeviceStatus[],
];

export const COMMAND_TYPE = {
  GET_DEVICE_STATUS: "GET_DEVICE_STATUS",
  SYNC_NOW: "SYNC_NOW",
  UPDATE_CONFIG: "UPDATE_CONFIG",
  SEND_SMS: "SEND_SMS",
} as const;
export type CommandType = (typeof COMMAND_TYPE)[keyof typeof COMMAND_TYPE];
export const COMMAND_TYPE_VALUES = Object.values(COMMAND_TYPE) as [
  CommandType,
  ...CommandType[],
];

export const COMMAND_STATUS = {
  PENDING: "PENDING",
  DELIVERED: "DELIVERED",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
} as const;
export type CommandStatus = (typeof COMMAND_STATUS)[keyof typeof COMMAND_STATUS];
export const COMMAND_STATUS_VALUES = Object.values(COMMAND_STATUS) as [
  CommandStatus,
  ...CommandStatus[],
];

/** Statuses a command can no longer move out of. */
export const TERMINAL_COMMAND_STATUSES: CommandStatus[] = [
  COMMAND_STATUS.SUCCESS,
  COMMAND_STATUS.FAILED,
  COMMAND_STATUS.EXPIRED,
];

export const COMMAND_PRIORITY = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type CommandPriority = (typeof COMMAND_PRIORITY)[keyof typeof COMMAND_PRIORITY];
export const COMMAND_PRIORITY_VALUES = Object.values(COMMAND_PRIORITY) as [
  CommandPriority,
  ...CommandPriority[],
];

/**
 * Numeric weight persisted alongside the priority label so MongoDB can sort by
 * priority without a `$switch` aggregation on the hot command-claim path.
 */
export const COMMAND_PRIORITY_WEIGHT: Record<CommandPriority, number> = {
  LOW: 10,
  NORMAL: 20,
  HIGH: 30,
  CRITICAL: 40,
};

export const LOG_LEVEL = {
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
} as const;
export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];
export const LOG_LEVEL_VALUES = Object.values(LOG_LEVEL) as [LogLevel, ...LogLevel[]];

export const NETWORK_TYPE = {
  WIFI: "WIFI",
  MOBILE: "MOBILE",
  ETHERNET: "ETHERNET",
  NONE: "NONE",
  UNKNOWN: "UNKNOWN",
} as const;
export type NetworkType = (typeof NETWORK_TYPE)[keyof typeof NETWORK_TYPE];
export const NETWORK_TYPE_VALUES = Object.values(NETWORK_TYPE) as [
  NetworkType,
  ...NetworkType[],
];

export const ACTOR_TYPE = {
  USER: "USER",
  DEVICE: "DEVICE",
  SYSTEM: "SYSTEM",
} as const;
export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];
export const ACTOR_TYPE_VALUES = Object.values(ACTOR_TYPE) as [ActorType, ...ActorType[]];

/** Envelope every API route returns. */
export type ApiSuccess<T> = { success: true; data: T; message: string };
export type ApiFailure = {
  success: false;
  message: string;
  errors: Record<string, string[]>;
  code?: string;
};
export type ApiResponseBody<T> = ApiSuccess<T> | ApiFailure;

export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
