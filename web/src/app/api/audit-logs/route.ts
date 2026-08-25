import { paginationSchema, searchParamsToObject } from "@/lib/pagination";
import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { requireOrgAdmin, resolveOrganizationScope } from "@/middleware/role.middleware";
import { AuditLogService } from "@/modules/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who did what. Administrators only, and scoped to their own organization. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  requireOrgAdmin(ctx);

  const params = searchParamsToObject(req.url);
  const pagination = paginationSchema.parse(params);
  const scope = resolveOrganizationScope(ctx, params.organizationId);

  return ok(
    await AuditLogService.list({ ...scope, action: params.action }, pagination),
    "Audit log",
  );
});
