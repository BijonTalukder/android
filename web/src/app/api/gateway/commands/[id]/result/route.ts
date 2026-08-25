import { handler, ok, readJson } from "@/lib/response";
import { commandResultSchema, CommandService } from "@/modules/command";
import { requireDeviceAuth } from "@/modules/gateway";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Acknowledge or complete a command.
 *
 * Safe to retry: submitting a result for a command that is already finished
 * returns the stored outcome and changes nothing.
 */
export const POST = handler(async (req: Request, { params }: Params) => {
  const device = await requireDeviceAuth(req);
  const { id } = await params;

  const input = commandResultSchema.parse(await readJson(req));
  const { command, idempotent } = await CommandService.submitResult(device, id, input);

  return ok(
    { command, idempotent },
    idempotent ? "Result already recorded" : "Result recorded",
  );
});
