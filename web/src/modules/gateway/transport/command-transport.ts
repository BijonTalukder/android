/**
 * Server-side command transport abstraction.
 *
 * Business logic never says "the device will poll for this". It says "dispatch
 * this command" and the transport decides how the device finds out. Today the
 * only implementation is polling, where dispatch is a no-op because the device
 * pulls. Adding WebSocket, MQTT or RabbitMQ means adding an implementation of
 * this interface and changing one line of configuration -- `CommandService`
 * and every route handler stay exactly as they are.
 */
import type { Types } from "mongoose";
import type { CommandPriority, CommandType } from "@/types";

export type DispatchableCommand = {
  id: string;
  organizationId: Types.ObjectId | string;
  deviceId: Types.ObjectId | string;
  type: CommandType;
  priority: CommandPriority;
};

export type DispatchResult = {
  /** `true` when the transport actively pushed to the device. */
  pushed: boolean;
  /** How the device is expected to receive the command. */
  mode: "PULL" | "PUSH";
  transport: string;
  detail?: string;
};

export interface CommandTransport {
  readonly name: string;
  /** Whether this transport can reach a device without the device asking. */
  readonly supportsPush: boolean;

  /** Called after a command has been persisted in PENDING state. */
  dispatch(command: DispatchableCommand): Promise<DispatchResult>;

  /**
   * Optional hint for the dashboard: how long, worst case, before the device
   * is expected to see the command. `null` when the transport cannot say.
   */
  expectedLatencySeconds(deviceConfig: { pollingIntervalSeconds: number }): number | null;
}
