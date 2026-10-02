import { requirePermission } from "@/lib/auth/session";
import { listAccounts } from "@/lib/auth/users";
import { canAssignIncident, eligibleAssignees } from "@/lib/alerts/assignment";
import { getAppContext } from "@/lib/services/context";
import { forbidden, json, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requirePermission("incidents:assign");
  if (!session || !canAssignIncident(session)) return forbidden();
  try {
    const app = await getAppContext();
    return json({ ok: true, assignees: eligibleAssignees(await listAccounts(), app.brand) });
  } catch (error) { return serverError("api", error, "incidents/assignees"); }
}
