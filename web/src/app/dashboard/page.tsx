"use client";

import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  CommandStatusBadge,
  DeviceStatusBadge,
} from "@/components/ui/badge";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/states";
import { PageHeader } from "@/components/dashboard/shell";
import { formatBattery, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DashboardSummary } from "@/modules/dashboard";

/** Poll interval for the overview. Matches the default device heartbeat. */
const REFRESH_MS = 15_000;

function Stat({
  label,
  value,
  tone = "neutral",
  href,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
  href?: string;
}) {
  const toneClass = {
    neutral: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    accent: "text-accent",
  }[tone];

  const content = (
    <div className="rounded-xl border border-border-base bg-surface px-4 py-3.5 transition-colors hover:border-border-strong">
      <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </p>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular", toneClass)}>{value}</p>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}

export default function DashboardOverviewPage() {
  const { data, error, loading } = useApi<DashboardSummary>(
    "/api/dashboard/summary",
    REFRESH_MS,
  );

  return (
    <>
      <PageHeader
        title="Overview"
        description="Fleet health and recent gateway activity."
      />

      {error && !data ? <ErrorState message={error} /> : null}
      {loading && !data ? <Spinner label="Loading summary" /> : null}

      {data ? (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
              Devices
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Stat label="Total" value={data.devices.total} href="/dashboard/devices" />
              <Stat
                label="Online"
                value={data.devices.online}
                tone="success"
                href="/dashboard/devices?status=ONLINE"
              />
              <Stat
                label="Offline"
                value={data.devices.offline}
                href="/dashboard/devices?status=OFFLINE"
              />
              <Stat
                label="Inactive"
                value={data.devices.inactive}
                tone="warning"
                href="/dashboard/devices?status=INACTIVE"
              />
              <Stat
                label="Blocked"
                value={data.devices.blocked}
                tone="danger"
                href="/dashboard/devices?status=BLOCKED"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
              Commands
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Stat
                label="Pending"
                value={data.commands.pending}
                tone="warning"
                href="/dashboard/commands?status=PENDING"
              />
              <Stat label="In flight" value={data.commands.inFlight} tone="accent" />
              <Stat
                label="Succeeded"
                value={data.commands.success}
                tone="success"
                href="/dashboard/commands?status=SUCCESS"
              />
              <Stat
                label="Failed"
                value={data.commands.failed}
                tone="danger"
                href="/dashboard/commands?status=FAILED"
              />
              <Stat
                label="Expired"
                value={data.commands.expired}
                href="/dashboard/commands?status=EXPIRED"
              />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Device activity"
                description="Most recently seen devices"
                action={
                  <Link
                    href="/dashboard/devices"
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    View all
                  </Link>
                }
              />
              {data.recentDevices.length === 0 ? (
                <EmptyState
                  title="No devices yet"
                  description="Create an enrollment token and pair your first Android gateway."
                />
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {data.recentDevices.map((device) => (
                    <li key={device.id}>
                      <Link
                        href={`/dashboard/devices/${device.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-muted"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {device.deviceName}
                          </p>
                          <p className="truncate font-mono text-xs text-subtle">
                            {device.deviceId}
                            {device.model ? ` · ${device.model}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-xs text-muted tabular">
                            {formatBattery(device.batteryLevel)}
                          </span>
                          <span className="hidden text-xs text-muted sm:inline">
                            {formatRelative(device.lastSeenAt)}
                          </span>
                          <DeviceStatusBadge status={device.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Command activity"
                description="Latest queued and completed commands"
                action={
                  <Link
                    href="/dashboard/commands"
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    View all
                  </Link>
                }
              />
              {data.recentCommands.length === 0 ? (
                <EmptyState title="No commands yet" />
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {data.recentCommands.map((command) => (
                    <li
                      key={command.id}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {command.type}
                        </p>
                        <p className="truncate text-xs text-subtle">
                          {command.deviceName ?? "Unknown device"} ·{" "}
                          {formatRelative(command.createdAt)}
                        </p>
                      </div>
                      <CommandStatusBadge status={command.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Recent errors"
              description="Error-level events reported by devices"
              action={
                <Link
                  href="/dashboard/logs?level=ERROR"
                  className="text-xs font-medium text-accent hover:underline"
                >
                  View logs
                </Link>
              }
            />
            {data.recentErrors.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">No errors reported. </p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.recentErrors.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-mono text-xs text-danger">{entry.event}</p>
                      <p className="text-xs text-subtle">
                        {entry.deviceName ?? "Unknown device"} ·{" "}
                        {formatRelative(entry.createdAt)}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-foreground">{entry.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
