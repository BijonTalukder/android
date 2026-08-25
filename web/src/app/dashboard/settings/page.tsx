"use client";

import { useState } from "react";
import { api, ApiError, qs } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useSession } from "@/components/providers/session-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { Spinner } from "@/components/ui/states";
import { PageHeader } from "@/components/dashboard/shell";
import { formatRelative, titleCase } from "@/lib/format";
import { ROLES, type Paginated, type Role } from "@/types";
import type { OrganizationDto } from "@/modules/organization";
import type { UserDto } from "@/modules/user";
import type { AuditLogDto } from "@/modules/audit-log";

export default function SettingsPage() {
  const { user, canManage, isSuperAdmin } = useSession();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization configuration and team access."
      />

      <div className="space-y-4">
        {user?.organizationId ? (
          <OrganizationSettings
            organizationId={user.organizationId}
            editable={canManage}
          />
        ) : (
          <Card>
            <CardHeader
              title="Organization"
              description="Your account is not scoped to a single organization."
            />
            <CardBody>
              <p className="text-sm text-muted">
                You are signed in as a platform super admin. Manage tenants from the{" "}
                <a href="/dashboard/organizations" className="text-accent hover:underline">
                  Organizations
                </a>{" "}
                page.
              </p>
            </CardBody>
          </Card>
        )}

        {canManage ? <TeamSettings isSuperAdmin={isSuperAdmin} /> : null}

        {canManage ? <AuditTrail /> : null}
      </div>
    </>
  );
}

function OrganizationSettings({
  organizationId,
  editable,
}: {
  organizationId: string;
  editable: boolean;
}) {
  const { data, loading, refresh } = useApi<OrganizationDto>(
    `/api/organizations/${organizationId}`,
  );

  if (loading && !data) {
    return (
      <Card>
        <Spinner label="Loading organization" />
      </Card>
    );
  }
  if (!data) return null;

  return (
    // Remounting on `updatedAt` re-seeds the form from the server after every
    // save, which is why the form can own its state without an effect syncing
    // props into it.
    <OrganizationSettingsForm
      key={data.updatedAt}
      organization={data}
      editable={editable}
      onSaved={refresh}
    />
  );
}

function OrganizationSettingsForm({
  organization: data,
  editable,
  onSaved,
}: {
  organization: OrganizationDto;
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: data.name,
    offlineThresholdSeconds: data.settings.offlineThresholdSeconds?.toString() ?? "",
    pollingIntervalSeconds: data.settings.pollingIntervalSeconds?.toString() ?? "",
    heartbeatIntervalSeconds: data.settings.heartbeatIntervalSeconds?.toString() ?? "",
    smsEnabled: Boolean(data.settings.smsEnabled),
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const settings: Record<string, unknown> = { smsEnabled: form.smsEnabled };
      // Blank means "inherit the platform default", so omit rather than send 0.
      if (form.offlineThresholdSeconds)
        settings.offlineThresholdSeconds = Number(form.offlineThresholdSeconds);
      if (form.pollingIntervalSeconds)
        settings.pollingIntervalSeconds = Number(form.pollingIntervalSeconds);
      if (form.heartbeatIntervalSeconds)
        settings.heartbeatIntervalSeconds = Number(form.heartbeatIntervalSeconds);

      await api.patch(`/api/organizations/${data.id}`, {
        name: form.name,
        settings,
      });
      toast.success("Settings saved");
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Organization"
        description={`${data.slug} · created ${formatRelative(data.createdAt)}`}
        action={
          editable ? (
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save changes
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Organization name"
            value={form.name}
            disabled={!editable}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <Input
            label="Offline threshold (seconds)"
            type="number"
            min={30}
            max={86400}
            placeholder="Platform default"
            value={form.offlineThresholdSeconds}
            disabled={!editable}
            onChange={(event) =>
              setForm({ ...form, offlineThresholdSeconds: event.target.value })
            }
            hint="A device with no heartbeat for this long is shown as offline."
          />
          <Input
            label="Default polling interval (seconds)"
            type="number"
            min={5}
            max={3600}
            placeholder="Platform default"
            value={form.pollingIntervalSeconds}
            disabled={!editable}
            onChange={(event) =>
              setForm({ ...form, pollingIntervalSeconds: event.target.value })
            }
            hint="Applied to newly enrolled devices."
          />
          <Input
            label="Default heartbeat interval (seconds)"
            type="number"
            min={15}
            max={3600}
            placeholder="Platform default"
            value={form.heartbeatIntervalSeconds}
            disabled={!editable}
            onChange={(event) =>
              setForm({ ...form, heartbeatIntervalSeconds: event.target.value })
            }
          />
        </div>

        <div className="rounded-lg border border-border-base bg-surface-muted p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--accent)]"
              checked={form.smsEnabled}
              disabled={!editable}
              onChange={(event) => setForm({ ...form, smsEnabled: event.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Allow SEND_SMS commands
              </span>
              <span className="mt-1 block text-xs text-muted">
                Both this switch and the platform-wide <code>SMS_COMMAND_ENABLED</code>{" "}
                environment flag must be on before a device will accept an SMS command.
                Enable it only where outbound SMS is permitted by the carrier, the
                recipient has consented, and the deployment complies with local law and
                Google Play policy. Every SMS command is recorded in the device log.
              </span>
            </span>
          </label>
        </div>
      </CardBody>
    </Card>
  );
}

function TeamSettings({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const toast = useToast();
  const { user } = useSession();
  const { data, loading, refresh } = useApi<Paginated<UserDto>>(
    `/api/users${qs({ limit: 50 })}`,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function mutate(id: string, body: Record<string, unknown>, message: string) {
    setPendingId(id);
    try {
      await api.patch(`/api/users/${id}`, body);
      toast.success(message);
      refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not update the user");
    } finally {
      setPendingId(null);
    }
  }

  async function remove(id: string) {
    setPendingId(id);
    try {
      await api.del(`/api/users/${id}`);
      toast.success("User removed");
      refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not remove the user");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Team"
          description="People who can sign in to this dashboard."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Add user
            </Button>
          }
        />
        {loading && !data ? (
          <Spinner label="Loading users" />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Last login</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items.length ?? 0) === 0 ? (
                  <EmptyRow colSpan={6} message="No users yet." />
                ) : (
                  data!.items.map((row) => {
                    const isSelf = row.id === user?.id;
                    return (
                      <Tr key={row.id}>
                        <Td className="font-medium">
                          {row.name}
                          {isSelf ? (
                            <span className="ml-2 text-xs text-subtle">(you)</span>
                          ) : null}
                        </Td>
                        <Td className="text-muted">{row.email}</Td>
                        <Td>
                          <Badge tone="accent">{titleCase(row.role)}</Badge>
                        </Td>
                        <Td>
                          <Badge tone={row.status === "ACTIVE" ? "success" : "warning"}>
                            {row.status}
                          </Badge>
                        </Td>
                        <Td className="text-muted">{formatRelative(row.lastLoginAt)}</Td>
                        <Td className="text-right">
                          {isSelf ? (
                            <span className="text-xs text-subtle">—</span>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                loading={pendingId === row.id}
                                onClick={() =>
                                  void mutate(
                                    row.id,
                                    {
                                      status:
                                        row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                                    },
                                    row.status === "ACTIVE"
                                      ? "User suspended"
                                      : "User reactivated",
                                  )
                                }
                              >
                                {row.status === "ACTIVE" ? "Suspend" : "Activate"}
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                loading={pendingId === row.id}
                                onClick={() => void remove(row.id)}
                              >
                                Remove
                              </Button>
                            </div>
                          )}
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <CreateUserModal
        open={createOpen}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
    </>
  );
}

function CreateUserModal({
  open,
  isSuperAdmin,
  onClose,
  onCreated,
}: {
  open: boolean;
  isSuperAdmin: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: ROLES.ORGANIZATION_MEMBER as Role,
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/users", form);
      toast.success("User created");
      setForm({ name: "", email: "", password: "", role: ROLES.ORGANIZATION_MEMBER });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) setError(err);
      toast.error(err instanceof ApiError ? err.message : "Could not create the user");
    } finally {
      setSaving(false);
    }
  }

  const roles: Role[] = isSuperAdmin
    ? [ROLES.ORGANIZATION_MEMBER, ROLES.ORGANIZATION_ADMIN, ROLES.SUPER_ADMIN]
    : [ROLES.ORGANIZATION_MEMBER, ROLES.ORGANIZATION_ADMIN];

  return (
    <Modal
      open={open}
      title="Add a user"
      description="They can sign in immediately with the password you set."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Create user
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          error={error?.fieldError("name")}
        />
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          error={error?.fieldError("email")}
        />
        <Input
          label="Temporary password"
          type="password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          error={error?.fieldError("password")}
          hint="At least 10 characters, with upper case, lower case and a digit."
        />
        <Select
          label="Role"
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {titleCase(role)}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}

/**
 * The audit trail. An audit log nobody can read is not an audit log, so the
 * entries the services write are surfaced here rather than only living in the
 * database.
 */
function AuditTrail() {
  const { data, loading } = useApi<Paginated<AuditLogDto>>(
    `/api/audit-logs${qs({ limit: 25 })}`,
    30_000,
  );

  return (
    <Card>
      <CardHeader
        title="Admin activity"
        description="Every privileged action, newest first."
      />
      {loading && !data ? (
        <Spinner label="Loading activity" />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {(data?.items.length ?? 0) === 0 ? (
                <EmptyRow colSpan={5} message="No recorded activity yet." />
              ) : (
                data!.items.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap text-muted tabular">
                      {formatRelative(entry.createdAt)}
                    </Td>
                    <Td>
                      <span className="font-medium">{entry.actor}</span>
                      <span className="ml-2 text-xs text-subtle">
                        {entry.actorType.toLowerCase()}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs text-muted">{entry.action}</Td>
                    <Td className="text-muted">{entry.targetType ?? "—"}</Td>
                    <Td className="font-mono text-xs text-subtle">{entry.ip ?? "—"}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
