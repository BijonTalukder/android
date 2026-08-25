import { cn } from "@/lib/cn";
import type { CommandPriority, CommandStatus, DeviceStatus, LogLevel } from "@/types";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-muted",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const DEVICE_TONES: Record<DeviceStatus, Tone> = {
  ONLINE: "success",
  OFFLINE: "neutral",
  INACTIVE: "warning",
  BLOCKED: "danger",
};

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  return (
    <Badge tone={DEVICE_TONES[status]}>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-current",
          status === "ONLINE" && "animate-pulse",
        )}
      />
      {status}
    </Badge>
  );
}

const COMMAND_TONES: Record<CommandStatus, Tone> = {
  PENDING: "warning",
  DELIVERED: "accent",
  PROCESSING: "accent",
  SUCCESS: "success",
  FAILED: "danger",
  EXPIRED: "neutral",
};

export function CommandStatusBadge({ status }: { status: CommandStatus }) {
  return <Badge tone={COMMAND_TONES[status]}>{status}</Badge>;
}

const PRIORITY_TONES: Record<CommandPriority, Tone> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warning",
  CRITICAL: "danger",
};

export function PriorityBadge({ priority }: { priority: CommandPriority }) {
  return <Badge tone={PRIORITY_TONES[priority]}>{priority}</Badge>;
}

const LEVEL_TONES: Record<LogLevel, Tone> = {
  INFO: "accent",
  WARNING: "warning",
  ERROR: "danger",
};

export function LogLevelBadge({ level }: { level: LogLevel }) {
  return <Badge tone={LEVEL_TONES[level]}>{level}</Badge>;
}
