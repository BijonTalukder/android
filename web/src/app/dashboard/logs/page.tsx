"use client";

import { Suspense } from "react";
import Link from "next/link";
import { qs } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LogLevelBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { ErrorState, Spinner } from "@/components/ui/states";
import { PageHeader } from "@/components/dashboard/shell";
import { formatDateTime } from "@/lib/format";
import { LOG_LEVEL_VALUES, type LogLevel, type Paginated } from "@/types";
import type { DeviceDto } from "@/modules/device";

type LogRow = {
  id: string;
  deviceId: string;
  deviceName: string | null;
  devicePublicId: string | null;
  level: LogLevel;
  event: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

const DEFAULTS = { deviceId: "", level: "", search: "", from: "", to: "", page: "1" };

function LogsTable() {
  const { values, setFilters } = useUrlFilters(DEFAULTS);

  const path = `/api/logs${qs({
    deviceId: values.deviceId,
    level: values.level,
    search: values.search,
    from: values.from ? new Date(values.from).toISOString() : "",
    to: values.to ? new Date(`${values.to}T23:59:59`).toISOString() : "",
    page: values.page,
    limit: 25,
  })}`;

  const { data, error, loading, refresh } = useApi<Paginated<LogRow>>(path, 10_000);
  const devices = useApi<Paginated<DeviceDto>>(`/api/devices${qs({ limit: 100 })}`);

  return (
    <>
      <PageHeader
        title="Logs"
        description="Events reported by devices and recorded by the platform."
        action={<Button onClick={refresh}>Refresh</Button>}
      />

      <Card>
        <div className="grid gap-3 border-b border-border-base px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
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
            label="Level"
            value={values.level}
            onChange={(event) => setFilters({ level: event.target.value })}
          >
            <option value="">All levels</option>
            {LOG_LEVEL_VALUES.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </Select>
          <Input
            label="Message contains"
            defaultValue={values.search}
            placeholder="timeout, failed…"
            onChange={(event) => setFilters({ search: event.target.value })}
          />
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
        {loading && !data ? <Spinner label="Loading logs" /> : null}

        {data ? (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Timestamp</Th>
                    <Th>Device</Th>
                    <Th>Level</Th>
                    <Th>Event</Th>
                    <Th>Message</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 ? (
                    <EmptyRow colSpan={5} message="No log entries match these filters." />
                  ) : (
                    data.items.map((log) => (
                      <Tr key={log.id}>
                        <Td className="whitespace-nowrap text-muted tabular">
                          {formatDateTime(log.createdAt)}
                        </Td>
                        <Td>
                          <Link
                            href={`/dashboard/devices/${log.deviceId}`}
                            className="font-medium text-foreground hover:text-accent"
                          >
                            {log.deviceName ?? log.devicePublicId ?? "Unknown"}
                          </Link>
                        </Td>
                        <Td>
                          <LogLevelBadge level={log.level} />
                        </Td>
                        <Td className="font-mono text-xs text-muted">{log.event}</Td>
                        <Td className="max-w-[28rem]">{log.message}</Td>
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
    </>
  );
}

export default function LogsPage() {
  return (
    <Suspense fallback={<Spinner label="Loading logs" />}>
      <LogsTable />
    </Suspense>
  );
}
