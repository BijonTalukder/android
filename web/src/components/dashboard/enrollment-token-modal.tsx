"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/providers/toast-provider";
import { formatDateTime } from "@/lib/format";

type EnrollmentToken = {
  id: string;
  token?: string;
  expiresAt: string;
  maxUses: number;
};

/**
 * Mints an enrollment code. The plaintext code exists only in this response,
 * so the modal makes that explicit rather than letting an admin assume they
 * can look it up again later.
 */
export function EnrollmentTokenModal({
  open,
  onClose,
  organizationId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  organizationId?: string;
  onCreated?: () => void;
}) {
  const toast = useToast();
  const [deviceNameHint, setDeviceNameHint] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [hours, setHours] = useState("24");
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<EnrollmentToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setIssued(null);
    setError(null);
    setDeviceNameHint("");
    setMaxUses("1");
    setHours("24");
  }

  async function create() {
    setSubmitting(true);
    setError(null);
    try {
      const token = await api.post<EnrollmentToken>("/api/devices/enrollment-token", {
        ...(deviceNameHint ? { deviceNameHint } : {}),
        ...(organizationId ? { organizationId } : {}),
        maxUses: Number(maxUses) || 1,
        expiresInSeconds: Math.max(300, (Number(hours) || 24) * 3600),
      });
      setIssued(token);
      onCreated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the token");
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!issued?.token) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      toast.success("Enrollment code copied");
    } catch {
      toast.error("Copy failed — select the code and copy it manually");
    }
  }

  return (
    <Modal
      open={open}
      title="New enrollment token"
      description="A device redeems this code once to obtain its own API token."
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        issued ? (
          <>
            <Button onClick={reset}>Create another</Button>
            <Button
              variant="primary"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Done
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void create()}>
              Create token
            </Button>
          </>
        )
      }
    >
      {issued?.token ? (
        <div className="space-y-3">
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            Copy this code now. It is stored only as a hash and cannot be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-surface-muted px-3 py-2.5 font-mono text-base tracking-widest text-foreground">
              {issued.token}
            </code>
            <Button onClick={() => void copy()}>Copy</Button>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted">Expires</dt>
              <dd className="text-foreground">{formatDateTime(issued.expiresAt)}</dd>
            </div>
            <div>
              <dt className="text-muted">Uses allowed</dt>
              <dd className="text-foreground tabular">{issued.maxUses}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="space-y-4">
          <Input
            label="Device name hint (optional)"
            value={deviceNameHint}
            onChange={(e) => setDeviceNameHint(e.target.value)}
            placeholder="Warehouse Gateway 01"
            hint="Overrides the name the app reports at enrollment."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Maximum uses"
              type="number"
              min={1}
              max={500}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
            <Input
              label="Valid for (hours)"
              type="number"
              min={1}
              max={720}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          {error ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
