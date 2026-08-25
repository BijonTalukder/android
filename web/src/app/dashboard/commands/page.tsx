"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { api, ApiError, qs } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useSession } from "@/components/providers/session-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommandStatusBadge, PriorityBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { ErrorState, Spinner } from "@/components/ui/states";
import { PageHeader } from "@/components/dashboard/shell";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  COMMAND_PRIORITY_VALUES,
  COMMAND_STATUS_VALUES,
  COMMAND_TYPE_VALUES,
  type Paginated,
} from "@/types";
import type { CommandDto } from "@/modules/command";
import type { DeviceDto } from "@/modules/device";

const DEFAULTS = {
  deviceId: "",
  type: "",
  status: "",
  priority: "",
  from: "",
  to: "",
  page: "1",
};

function CommandsTable() {
  const toast = useToast();
  const { canManage } = useSession();
  const { values, setFilters } = useUrlFilters(DEFAULTS);
  const [selected, setSelected] = useState<CommandDto | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const path = `/api/commands${qs({
    deviceId: values.deviceId,
    type: values.type,
    status: values.status,
    priority: values.priority,
    from: values.from ? new Date(values.from).toISOString() : "",
    to: values.to ? new Date(`${values.to}T23:59:59`).toISOString() : "",
    page: values.page,
    limit: 20,
  })}`;

  const { data, error, loading, refresh } = useApi<Paginated<CommandDto>>(path, 10_000);
  // Populates the device filter without a dedicated endpoint.
  const devices = useApi<Paginated<DeviceDto>>(`/api/devices${qs({ limit: 100 })}`);

  async function cancel(command: CommandDto) {
    setCancelling(true);
    try {
      await api.post(`/api/commands/${command.id}/cancel`);
      toast.success("Command cancelled");
      setSelected(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not cancel the command");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Commands"
        description="Every command queued across your devices."
        action={<Button onClick={refresh}>Refresh</Button>}
      />

      <Card>
        <div className="grid gap-3 border-b border-border-base px-5 py-4 sm:grid-cols-2 xl:grid-cols-6">
          <Select
            label="Device"
            value={values.deviceId}
            onChange={(event) => setFilters({ deviceId: event.target.value })}
          >
            <option value="">All devices</option>
            {devices.data?.items.map((device) => (
              <option key={device.id} value={device.id}>
                {device.deviceName} ({device.deviceId})
              </option>
            ))}
          </Select>
          <Select
            label="Type"
            value={values.type}
            onChange={(event) => setFilters({ type: event.target.value })}
          >
            <option value="">All types</option>
            {COMMAND_TYPE_VALUES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
          <Select
            label="Status"
            value={values.status}
            onChange={(event) => setFilters({ status: event.target.value })}
          >
            <option value="">All statuses</option>
            {COMMAND_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
          <Select
            label="Priority"
            value={values.priority}
            onChange={(event) => setFilters({ priority: event.target.value })}
          >
            <option value="">All priorities</option>
            {COMMAND_PRIORITY_VALUES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </Select>
          <Input
            label="From"
            type="date"
            value={values.from}
            onChange={(event) => setFilters({ from: event.target.value })}
          />
          <Input
            label="To"
            type="date"
            value={values.to}
            onChange={(event) => setFilters({ to: event.target.value })}
          />
        </div>

        {error && !data ? <ErrorState message={error} /> : null}
        {loading && !data ? <Spinner label="Loading commands" /> : null}

        {data ? (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Command ID</Th>
                    <Th>Device</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Priority</Th>
                    <Th>Created</Th>
                    <Th>Executed</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 ? (
                    <EmptyRow colSpan={8} message="No commands match these filters." />
                  ) : (
                    data.items.map((command) => (
                      <Tr key={command.id}>
                        <Td className="font-mono text-xs text-muted">
                          {command.id.slice(-8)}
                        </Td>
                        <Td>
                          {command.device ? (
                            <Link
                              href={`/dashboard/devices/${command.device.id}`}
                              className="font-medium text-foreground hover:text-accent"
                            >
                              {command.device.deviceName}
                            </Link>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </Td>
                        <Td className="font-medium">{command.type}</Td>
                        <Td>
                          <CommandStatusBadge status={command.status} />
                        </Td>
                        <Td>
                          <PriorityBadge priority={command.priority} />
                        </Td>
                        <Td className="whitespace-nowrap text-muted">
                          {formatRelative(command.createdAt)}
                        </Td>
                        <Td className="whitespace-nowrap text-muted">
                          {formatRelative(command.executedAt)}
                        </Td>
                        <Td className="text-right">
                          <Button size="sm" onClick={() => setSelected(command)}>
                            Details
                          </Button>
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination
              page={Number(values.page) || 1}
              data={data}
              onPageChange={(page) => setFilters({ page: String(page) }, { resetPage: false })}
            />
          </>
        ) : null}
      </Card>

      <Modal
        open={selected !== null}
        title={selected ? `${selected.type}` : ""}
        description={selected ? `Command ${selected.id}` : undefined}
        onClose={() => setSelected(null)}
        footer={
          <>
            {canManage && selected?.status === "PENDING" ? (
              <Button
                variant="danger"
                loading={cancelling}
                onClick={() => void cancel(selected)}
              >
                Cancel command
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setSelected(null)}>
              Close
            </Button>
          </>
        }
      >
        {selected ? (
          <dl className="space-y-3 text-sm">
            <Detail label="Status" value={<CommandStatusBadge status={selected.status} />} />
            <Detail label="Priority" value={<PriorityBadge priority={selected.priority} />} />
            <Detail
              label="Device"
              value={selected.device ? `${selected.device.deviceName} (${selected.device.deviceId})` : "—"}
            />
            <Detail label="Created" value={formatDateTime(selected.createdAt)} />
            <Detail label="Delivered" value={formatDateTime(selected.sentAt)} />
            <Detail label="Executed" value={formatDateTime(selected.executedAt)} />
            <Detail label="Expires" value={formatDateTime(selected.expiresAt)} />
            <Detail label="Delivery attempts" value={String(selected.deliveryAttempts)} />
            <div>
              <dt className="mb-1 text-xs font-medium text-muted">Payload</dt>
              <dd>
                <pre className="max-h-40 overflow-auto rounded-lg bg-surface-muted p-3 font-mono text-xs">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </dd>
            </div>
            {selected.result ? (
              <div>
                <dt className="mb-1 text-xs font-medium text-muted">Result</dt>
                <dd>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-success-soft p-3 font-mono text-xs">
                    {JSON.stringify(selected.result, null, 2)}
                  </pre>
                </dd>
              </div>
            ) : null}
            {selected.error ? (
              <div>
                <dt className="mb-1 text-xs font-medium text-muted">Error</dt>
                <dd className="rounded-lg bg-danger-soft p-3 text-xs text-danger">
                  <strong>{selected.error.code}</strong>: {selected.error.message}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

export default function CommandsPage() {
  return (
    <Suspense fallback={<Spinner label="Loading commands" />}>
      <CommandsTable />
    </Suspense>
  );
}
