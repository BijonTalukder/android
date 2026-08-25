"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { qs } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeviceStatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { ErrorState, Spinner } from "@/components/ui/states";
import { PageHeader } from "@/components/dashboard/shell";
import { EnrollmentTokenModal } from "@/components/dashboard/enrollment-token-modal";
import { useSession } from "@/components/providers/session-provider";
import { formatBattery, formatRelative } from "@/lib/format";
import { DEVICE_STATUS_VALUES, type Paginated } from "@/types";
import type { DeviceDto } from "@/modules/device";

const DEFAULTS = { status: "", search: "", page: "1", sort: "lastSeenAt", order: "desc" };

function DevicesTable() {
  const { canManage } = useSession();
  const { values, setFilters } = useUrlFilters(DEFAULTS);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);

  const path = `/api/devices${qs({
    status: values.status,
    search: values.search,
    page: values.page,
    sort: values.sort,
    order: values.order,
    limit: 20,
  })}`;

  const { data, error, loading, refresh } = useApi<Paginated<DeviceDto>>(path, 15_000);

  return (
    <>
      <PageHeader
        title="Devices"
        description="Every Android gateway enrolled in your organization."
        action={
          canManage ? (
            <Button variant="primary" onClick={() => setTokenModalOpen(true)}>
              New enrollment token
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border-base px-5 py-4">
          <div className="min-w-[14rem] flex-1">
            <Input
              label="Search"
              placeholder="Name, device ID, model…"
              defaultValue={values.search}
              onChange={(event) => setFilters({ search: event.target.value })}
            />
          </div>
          <div className="w-40">
            <Select
              label="Status"
              value={values.status}
              onChange={(event) => setFilters({ status: event.target.value })}
            >
              <option value="">All statuses</option>
              {DEVICE_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select
              label="Sort by"
              value={values.sort}
              onChange={(event) => setFilters({ sort: event.target.value })}
            >
              <option value="lastSeenAt">Last seen</option>
              <option value="createdAt">Enrolled</option>
              <option value="deviceName">Name</option>
            </Select>
          </div>
          <Button onClick={refresh}>Refresh</Button>
        </div>

        {error && !data ? <ErrorState message={error} /> : null}
        {loading && !data ? <Spinner label="Loading devices" /> : null}

        {data ? (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Device</Th>
                    <Th>Device ID</Th>
                    <Th>Model</Th>
                    <Th>Android</Th>
                    <Th>Status</Th>
                    <Th>Battery</Th>
                    <Th>Last seen</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 ? (
                    <EmptyRow
                      colSpan={8}
                      message={
                        values.search || values.status
                          ? "No devices match these filters."
                          : "No devices enrolled yet. Create an enrollment token to pair one."
                      }
                    />
                  ) : (
                    data.items.map((device) => (
                      <Tr key={device.id}>
                        <Td>
                          <Link
                            href={`/dashboard/devices/${device.id}`}
                            className="font-medium text-foreground hover:text-accent"
                          >
                            {device.deviceName}
                          </Link>
                        </Td>
                        <Td className="font-mono text-xs text-muted">{device.deviceId}</Td>
                        <Td className="text-muted">
                          {device.manufacturer ? `${device.manufacturer} ` : ""}
                          {device.model ?? "—"}
                        </Td>
                        <Td className="text-muted tabular">
                          {device.androidVersion ?? "—"}
                          {device.sdkVersion ? ` (API ${device.sdkVersion})` : ""}
                        </Td>
                        <Td>
                          <DeviceStatusBadge status={device.status} />
                        </Td>
                        <Td className="text-muted tabular">
                          {formatBattery(device.batteryLevel)}
                          {device.isCharging ? " ⚡" : ""}
                        </Td>
                        <Td className="text-muted">{formatRelative(device.lastSeenAt)}</Td>
                        <Td className="text-right">
                          <Link href={`/dashboard/devices/${device.id}`}>
                            <Button size="sm">View</Button>
                          </Link>
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

      <EnrollmentTokenModal
        open={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        onCreated={refresh}
      />
    </>
  );
}

export default function DevicesPage() {
  return (
    <Suspense fallback={<Spinner label="Loading devices" />}>
      <DevicesTable />
    </Suspense>
  );
}
