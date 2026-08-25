/**
 * Transport registry.
 *
 * Swapping the platform onto a push transport is a change here and nowhere
 * else. Future entries: `websocket`, `mqtt`, `rabbitmq`.
 */
import { PollingCommandTransport } from "./polling-command-transport";
import type { CommandTransport } from "./command-transport";

const registry = new Map<string, () => CommandTransport>([
  ["polling", () => new PollingCommandTransport()],
]);

let instance: CommandTransport | null = null;

export function getCommandTransport(): CommandTransport {
  if (instance) return instance;
  const name = process.env.COMMAND_TRANSPORT ?? "polling";
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown COMMAND_TRANSPORT "${name}". Known transports: ${[...registry.keys()].join(", ")}`,
    );
  }
  instance = factory();
  return instance;
}

/** Test seam. */
export function setCommandTransport(transport: CommandTransport | null) {
  instance = transport;
}

export type {
  CommandTransport,
  DispatchResult,
  DispatchableCommand,
} from "./command-transport";
export { PollingCommandTransport } from "./polling-command-transport";
