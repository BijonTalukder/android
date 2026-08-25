"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/providers/toast-provider";
import { COMMAND_PRIORITY_VALUES, type CommandPriority } from "@/types";

type Props = {
  deviceId: string;
  disabled?: boolean;
  /** Mirrors the server's combined platform + tenant SMS switch. */
  smsEnabled: boolean;
  onQueued: () => void;
};

/**
 * The four MVP commands, as buttons.
 *
 * Payloads are validated again on the server against the same contracts in
 * `modules/command/command.schema.ts`; the inline validation here exists to
 * give immediate feedback, not to be the gate.
 */
export function CommandActions({ deviceId, disabled, smsEnabled, onQueued }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);

  async function queue(type: string, payload: Record<string, unknown>, priority?: CommandPriority) {
    setBusy(type);
    try {
      await api.post(`/api/devices/${deviceId}/commands`, {
        type,
        payload,
        ...(priority ? { priority } : {}),
      });
      toast.success(`${type} queued`);
      onQueued();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `Could not queue ${type}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled}
          loading={busy === "GET_DEVICE_STATUS"}
          onClick={() => void queue("GET_DEVICE_STATUS", {}, "HIGH")}
        >
          Get status
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          loading={busy === "SYNC_NOW"}
          onClick={() => void queue("SYNC_NOW", { scope: "ALL" })}
        >
          Sync now
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => setConfigOpen(true)}>
          Update config
        </Button>
        <Button
          size="sm"
          disabled={disabled || !smsEnabled}
          title={
            smsEnabled
              ? undefined
              : "SMS sending is disabled for this deployment or organization."
          }
          onClick={() => setSmsOpen(true)}
        >
          Send SMS
        </Button>
      </div>

      <UpdateConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSubmit={async (payload, priority) => {
          const okResult = await queue("UPDATE_CONFIG", payload, priority);
          if (okResult) setConfigOpen(false);
        }}
        busy={busy === "UPDATE_CONFIG"}
      />

      <SendSmsModal
        open={smsOpen}
        onClose={() => setSmsOpen(false)}
        onSubmit={async (payload, priority) => {
          const okResult = await queue("SEND_SMS", payload, priority);
          if (okResult) setSmsOpen(false);
        }}
        busy={busy === "SEND_SMS"}
      />
    </>
  );
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: CommandPriority;
  onChange: (value: CommandPriority) => void;
}) {
  return (
    <Select
      label="Priority"
      value={value}
      onChange={(event) => onChange(event.target.value as CommandPriority)}
    >
      {COMMAND_PRIORITY_VALUES.map((priority) => (
        <option key={priority} value={priority}>
          {priority}
        </option>
      ))}
    </Select>
  );
}

function UpdateConfigModal({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, priority: CommandPriority) => Promise<void>;
  busy: boolean;
}) {
  const [polling, setPolling] = useState("30");
  const [heartbeat, setHeartbeat] = useState("60");
  const [priority, setPriority] = useState<CommandPriority>("NORMAL");

  return (
    <Modal
      open={open}
      title="Update device configuration"
      description="The app stores these locally and applies them to its workers."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() =>
              void onSubmit(
                {
                  pollingIntervalSeconds: Number(polling),
                  heartbeatIntervalSeconds: Number(heartbeat),
                },
                priority,
              )
            }
          >
            Queue command
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Polling interval (seconds)"
          type="number"
          min={5}
          max={3600}
          value={polling}
          onChange={(event) => setPolling(event.target.value)}
          hint="How often the app claims commands. Minimum 5s."
        />
        <Input
          label="Heartbeat interval (seconds)"
          type="number"
          min={15}
          max={3600}
          value={heartbeat}
          onChange={(event) => setHeartbeat(event.target.value)}
          hint="Android schedules periodic work no more often than 15 minutes."
        />
        <PrioritySelect value={priority} onChange={setPriority} />
      </div>
    </Modal>
  );
}

function SendSmsModal({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, priority: CommandPriority) => Promise<void>;
  busy: boolean;
}) {
  const [destination, setDestination] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<CommandPriority>("NORMAL");

  const segments = message.length === 0 ? 0 : Math.ceil(message.length / 153);
  const valid = /^\+?[0-9]{6,15}$/.test(destination.trim()) && message.length > 0;

  return (
    <Modal
      open={open}
      title="Send SMS"
      description="The device sends this through its own SIM, subject to Android permissions."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={() =>
              void onSubmit(
                { destination: destination.trim(), message },
                priority,
              )
            }
          >
            Queue SMS
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          Send only messages the recipient has consented to receive. Outbound SMS is
          subject to carrier rules, local law and Google Play policy, and the device
          asks the user to grant the SEND_SMS permission before anything is sent.
        </p>
        <Input
          label="Destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="+8801712345678"
          hint="E.164 or a national number, 6–15 digits."
          error={
            destination && !/^\+?[0-9]{6,15}$/.test(destination.trim())
              ? "Enter a valid phone number"
              : undefined
          }
        />
        <Textarea
          label="Message"
          rows={4}
          maxLength={1530}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          hint={`${message.length}/1530 characters · ${segments} SMS segment${segments === 1 ? "" : "s"}`}
        />
        <PrioritySelect value={priority} onChange={setPriority} />
      </div>
    </Modal>
  );
}
