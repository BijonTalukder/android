"use client";

import { useState } from "react";
import { api, ApiError, qs } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useSession } from "@/components/providers/session-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState, Spinner } from "@/components/ui/states";
import { PageHeader } from "@/components/dashboard/shell";
import { formatRelative } from "@/lib/format";
import type { Paginated } from "@/types";
import type { OrganizationDto } from "@/modules/organization";

type OrganizationRow = OrganizationDto & { userCount: number; deviceCount: number };

/** Platform administration. Only a SUPER_ADMIN can reach the API behind it. */
export default function OrganizationsPage() {
  const { isSuperAdmin, loading: sessionLoading } = useSession();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, loading, refresh } = useApi<Paginated<OrganizationRow>>(
    isSuperAdmin ? `/api/organizations${qs({ limit: 50 })}` : null,
  );

  if (sessionLoading) return <Spinner />;

  if (!isSuperAdmin) {
    return (
      <Card>
        <EmptyState
          title="Platform administration"
          description="Only a super admin can manage organizations."
        />
      </Card>
    );
  }

  async function toggleStatus(row: OrganizationRow) {
    setPendingId(row.id);
    try {
      await api.patch(`/api/organizations/${row.id}`, {
        status: row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
      });
      toast.success(row.status === "ACTIVE" ? "Organization suspended" : "Organization activated");
      refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not update the organization");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Every tenant on this platform."
        action={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New organization
          </Button>
        }
      />

      <Card>
        {loading && !data ? (
          <Spinner label="Loading organizations" />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Slug</Th>
                  <Th>Status</Th>
                  <Th>Users</Th>
                  <Th>Devices</Th>
                  <Th>SMS</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items.length ?? 0) === 0 ? (
                  <EmptyRow colSpan={8} message="No organizations yet." />
                ) : (
                  data!.items.map((row) => (
                    <Tr key={row.id}>
                      <Td className="font-medium">{row.name}</Td>
                      <Td className="font-mono text-xs text-muted">{row.slug}</Td>
                      <Td>
                        <Badge tone={row.status === "ACTIVE" ? "success" : "warning"}>
                          {row.status}
                        </Badge>
                      </Td>
                      <Td className="tabular text-muted">{row.userCount}</Td>
                      <Td className="tabular text-muted">{row.deviceCount}</Td>
                      <Td>
                        {row.settings.smsEnabled ? (
                          <Badge tone="warning">Enabled</Badge>
                        ) : (
                          <span className="text-xs text-subtle">Off</span>
                        )}
                      </Td>
                      <Td className="text-muted">{formatRelative(row.createdAt)}</Td>
                      <Td className="text-right">
                        <Button
                          size="sm"
                          loading={pendingId === row.id}
                          onClick={() => void toggleStatus(row)}
                        >
                          {row.status === "ACTIVE" ? "Suspend" : "Activate"}
                        </Button>
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <CreateOrganizationModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
    </>
  );
}

function CreateOrganizationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/organizations", {
        name: form.name,
        // Provisioning the first admin in the same call means a tenant is
        // never created without a way in.
        admin: {
          name: form.adminName,
          email: form.adminEmail,
          password: form.adminPassword,
        },
      });
      toast.success("Organization created");
      setForm({ name: "", adminName: "", adminEmail: "", adminPassword: "" });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) setError(err);
      toast.error(err instanceof ApiError ? err.message : "Could not create the organization");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="New organization"
      description="Creates the tenant and its first administrator."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Organization name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          error={error?.fieldError("name")}
          hint="The URL slug is generated from this name."
        />
        <hr className="border-border-base" />
        <Input
          label="Administrator name"
          value={form.adminName}
          onChange={(event) => setForm({ ...form, adminName: event.target.value })}
          error={error?.fieldError("admin.name")}
        />
        <Input
          label="Administrator email"
          type="email"
          value={form.adminEmail}
          onChange={(event) => setForm({ ...form, adminEmail: event.target.value })}
          error={error?.fieldError("admin.email")}
        />
        <Input
          label="Administrator password"
          type="password"
          value={form.adminPassword}
          onChange={(event) => setForm({ ...form, adminPassword: event.target.value })}
          error={error?.fieldError("admin.password")}
          hint="At least 10 characters."
        />
      </div>
    </Modal>
  );
}
