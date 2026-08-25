"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, qs } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useSession } from "@/components/providers/session-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  CommandStatusBadge,
  DeviceStatusBadge,
  LogLevelBadge,
  PriorityBadge,
} from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { ErrorState, Spinner } from "@/components/ui/states";
import { PageHeader } from "@/components/dashboard/shell";
import { CommandActions } from "@/components/dashboard/command-actions";
import { formatBattery, formatDateTime, formatRelative } from "@/lib/format";
import type { CommandDto } from "@/modules/command";
import type { DeviceDto } from "@/modules/device";
import type { OrganizationDto } from "@/modules/organization";
import type { LogLevel, Paginated } from "@/types";

type DeviceLogRow = {
  id: string;
  level: LogLevel;
  event: string;
  message: string;
  createdAt: string;
};

export default function DeviceDetailPage({ params }: PageProps<"/dashboard/devices/[id]">) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { canManage } = useSession();

  const device = useApi<DeviceDto>(`/api/devices/${id}`, 10_000);
  const commands = useApi<Paginated<CommandDto>>(
    `/api/devices/${id}/commands${qs({ limit: 10 })}`,
    10_000,
  );
  const logs = useApi<Paginated<DeviceLogRow>>(
    `/api/devices/${id}/logs${qs({ limit: 15 })}`,
    10_000,
  );
  // Drives whether the SEND_SMS button is offered at all.
  const organization = useApi<OrganizationDto>(
    device.data ? `/api/organizations/${device.data.organizationId}` : null,
  );

  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirm, setConfirm] = useState<null | "block" | "unblock" | "delete" | "revoke">(null);
  const [busy, setBusy] = useState(false);

  function refreshAll() {
    device.refresh();
    commands.refresh();
    logs.refresh();
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      toast.success(successMessage);
      setConfirm(null);
      setRenameOpen(false);
      refreshAll();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (device.loading && !device.data) return <Spinner label="Loading device" />;
  if (device.error && !device.data) {
    return (
      <ErrorState
        message={device.error}
        action={
          <Link href="/dashboard/devices">
            <Button>Back to devices</Button>
          </Link>
        }
      />
    );
  }
  if (!device.data) return null;

  const d = device.data;
  const blocked = d.status === "BLOCKED";

  return (
    <>
      <PageHeader
        title={d.deviceName}
        description={`${d.deviceId} · enrolled ${formatRelative(d.enrolledAt)}`}
        action={
          <>
            <Link href="/dashboard/devices">
              <Button size="sm">Back</Button>
            </Link>
            {canManage ? (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setNewName(d.deviceName);
                    setRenameOpen(true);
                  }}
                >
                  Rename
                </Button>
                <Button size="sm" onClick={() => setConfirm("revoke")}>
                  Revoke token
                </Button>
                {blocked ? (
                  <Button size="sm" variant="primary" onClick={() => setConfirm("unblock")}>
                    Unblock
                  </Button>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => setConfirm("block")}>
                    Block
                  </Button>
                )}
                <Button size="sm" variant="danger" onClick={() => setConfirm("delete")}>
                  Delete
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {blocked ? (
        <div className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          <strong className="font-semibold">This device is blocked.</strong> It cannot
          poll, heartbeat or receive commands.
          {d.blockedReason ? ` Reason: ${d.blockedReason}` : ""}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ---------------- Overview & live status ---------------- */}
        <Card className="xl:col-span-1">
          <CardHeader title="Live status" description="Reported on the last heartbeat" />
          <CardBody className="space-y-3">
            <Row label="Status" value={<DeviceStatusBadge status={d.status} />} />
            <Row label="Last seen" value={formatRelative(d.lastSeenAt)} />
            <Row
              label="Battery"
              value={`${formatBattery(d.batteryLevel)}${d.isCharging ? " (charging)" : ""}`}
            />
            <Row label="Network" value={d.networkType ?? "—"} />
            <Row label="App version" value={d.appVersion ?? "—"} />
            <Row
              label="Polling"
              value={`every ${d.config.pollingIntervalSeconds}s`}
            />
            <Row
              label="Heartbeat"
              value={`every ${d.config.heartbeatIntervalSeconds}s`}
            />
          </CardBody>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader title="Device information" description="Reported at enrollment" />
          <CardBody className="space-y-3">
            <Row label="Device ID" value={<code className="font-mono text-xs">{d.deviceId}</code>} />
            <Row label="Manufacturer" value={d.manufacturer ?? "—"} />
            <Row label="Model" value={d.model ?? "—"} />
            <Row
              label="Android"
              value={
                d.androidVersion
                  ? `${d.androidVersion}${d.sdkVersion ? ` (API ${d.sdkVersion})` : ""}`
                  : "—"
              }
            />
            <Row label="Enrolled" value={formatDateTime(d.enrolledAt)} />
            <Row label="Token issued" value={formatDateTime(d.tokenIssuedAt)} />
          </CardBody>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader
            title="Send a command"
            description="Queued now, claimed on the device's next poll."
          />
          <CardBody className="space-y-3">
            {canManage ? (
              <CommandActions
                deviceId={d.id}
                disabled={blocked}
                smsEnabled={Boolean(organization.data?.settings?.smsEnabled)}
                onQueued={refreshAll}
              />
            ) : (
              <p className="text-sm text-muted">
                Your role can view this device but not send commands.
              </p>
            )}
            <p className="text-xs text-subtle">
              Expected delivery within {d.config.pollingIntervalSeconds}s while the
              device is online.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* ---------------- Recent commands ---------------- */}
      <Card className="mt-4">
        <CardHeader
          title="Recent commands"
          action={
            <Link
              href={`/dashboard/commands?deviceId=${d.id}`}
              className="text-xs font-medium text-accent hover:underline"
            >
              View all
            </Link>
          }
        />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Priority</Th>
                <Th>Created</Th>
                <Th>Executed</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {(commands.data?.items.length ?? 0) === 0 ? (
                <EmptyRow colSpan={6} message="No commands sent to this device yet." />
              ) : (
                commands.data!.items.map((command) => (
                  <Tr key={command.id}>
                    <Td className="font-medium">{command.type}</Td>
                    <Td>
                      <CommandStatusBadge status={command.status} />
                    </Td>
                    <Td>
                      <PriorityBadge priority={command.priority} />
                    </Td>
                    <Td className="text-muted">{formatRelative(command.createdAt)}</Td>
                    <Td className="text-muted">{formatRelative(command.executedAt)}</Td>
                    <Td className="max-w-[22rem]">
                      {command.error ? (
                        <span className="text-xs text-danger">
                          {command.error.code}: {command.error.message}
                        </span>
                      ) : command.result ? (
                        <code className="block truncate font-mono text-xs text-muted">
                          {JSON.stringify(command.result)}
                        </code>
                      ) : (
                        <span className="text-xs text-subtle">—</span>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {/* ---------------- Recent logs ---------------- */}
      <Card className="mt-4">
        <CardHeader
          title="Recent logs"
          action={
            <Link
              href={`/dashboard/logs?deviceId=${d.id}`}
              className="text-xs font-medium text-accent hover:underline"
            >
              View all
            </Link>
          }
        />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Level</Th>
                <Th>Event</Th>
                <Th>Message</Th>
              </tr>
            </thead>
            <tbody>
              {(logs.data?.items.length ?? 0) === 0 ? (
                <EmptyRow colSpan={4} message="No log entries for this device yet." />
              ) : (
                logs.data!.items.map((log) => (
                  <Tr key={log.id}>
                    <Td className="whitespace-nowrap text-muted">
                      {formatDateTime(log.createdAt)}
                    </Td>
                    <Td>
                      <LogLevelBadge level={log.level} />
                    </Td>
                    <Td className="font-mono text-xs text-muted">{log.event}</Td>
                    <Td>{log.message}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {/* ---------------- Modals ---------------- */}
      <Modal
        open={renameOpen}
        title="Rename device"
        onClose={() => setRenameOpen(false)}
        footer={
          <>
            <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                void run(
                  () => api.patch(`/api/devices/${d.id}`, { deviceName: newName.trim() }),
                  "Device renamed",
                )
              }
            >
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Device name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          maxLength={120}
        />
      </Modal>

      <Modal
        open={confirm !== null}
        title={
          confirm === "delete"
            ? "Delete this device?"
            : confirm === "block"
              ? "Block this device?"
              : confirm === "unblock"
                ? "Unblock this device?"
                : "Revoke the device token?"
        }
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant={confirm === "unblock" ? "primary" : "danger"}
              loading={busy}
              onClick={() => {
                if (confirm === "delete") {
                  void run(async () => {
                    await api.del(`/api/devices/${d.id}`);
                    router.replace("/dashboard/devices");
                  }, "Device deleted");
                } else if (confirm === "block") {
                  void run(
                    () =>
                      api.patch(`/api/devices/${d.id}`, {
                        status: "BLOCKED",
                        blockedReason: "Blocked from the dashboard",
                      }),
                    "Device blocked",
                  );
                } else if (confirm === "unblock") {
                  void run(
                    () => api.patch(`/api/devices/${d.id}`, { status: "OFFLINE" }),
                    "Device unblocked",
                  );
                } else if (confirm === "revoke") {
                  void run(
                    () => api.post(`/api/devices/${d.id}/revoke-token`),
                    "Device token revoked",
                  );
                }
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {confirm === "delete"
            ? "This permanently removes the device along with its commands and logs. It cannot be undone."
            : confirm === "block"
              ? "The device will immediately stop being able to poll or heartbeat, and every queued command will be dropped."
              : confirm === "unblock"
                ? "The device will be able to heartbeat again on its next attempt."
                : "The current API token stops working immediately. The device must re-enroll with a new enrollment code."}
        </p>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
