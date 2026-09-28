import { getSnapshot } from "@/lib/services/snapshot";
import { getIntegrations } from "@/lib/services/integrations";
import { json, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ ok: true, integrations: getIntegrations(await getSnapshot()) });
  } catch (err) {
    return serverError("api", err, "integrations");
  }
}
