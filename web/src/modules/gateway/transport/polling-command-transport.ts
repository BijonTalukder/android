/**
 * MVP transport: the device pulls from `GET /api/gateway/commands`.
 *
 * Dispatch is intentionally a no-op. The command is already durably PENDING in
 * MongoDB, which *is* the queue; the device's next poll performs the atomic
 * claim. Nothing is lost if the server restarts between create and delivery.
 */
import { logger } from "@/lib/logger";
import type {
  CommandTransport,
  DispatchResult,
  DispatchableCommand,
} from "./command-transport";

export class PollingCommandTransport implements CommandTransport {
  readonly name = "polling";
  readonly supportsPush = false;

  async dispatch(command: DispatchableCommand): Promise<DispatchResult> {
    logger.debug("Command queued for polling delivery", {
      commandId: command.id,
      type: command.type,
    });
    return {
      pushed: false,
      mode: "PULL",
      transport: this.name,
      detail: "Queued; the device will claim it on its next poll.",
    };
  }

  expectedLatencySeconds(deviceConfig: { pollingIntervalSeconds: number }): number | null {
    return deviceConfig.pollingIntervalSeconds;
  }
}
