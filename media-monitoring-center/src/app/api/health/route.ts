import { getEnv } from "@/lib/config/env";
import { json } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  return json({
    ok: true,
    app: env.appName,
    version: "0.1.0",
    mode: env.useMockData ? "mock" : "bigquery",
    time: new Date().toISOString(),
    integrations: { bigquery: env.bigquery.configured, n8n: env.n8n.configured, whatsapp: env.whatsapp.enabled },
  });
}
