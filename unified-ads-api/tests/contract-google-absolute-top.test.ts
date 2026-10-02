import { describe, expect, it } from "vitest";
import { GoogleProvider } from "../src/providers/google/index.js";
import type { GoogleRow } from "../src/providers/google/types.js";
import { GOOGLE_ENV, GoogleSimulator } from "./google-simulator.js";

// Contrato independiente de capacidad: una lectura que excede el límite por nivel falla de forma
// explícita antes de descargar páginas de métricas; nunca devuelve una muestra truncada.
const ACCOUNT_ID = "8779536058";

function campaign(id: string): GoogleRow {
  return {
    campaign: { id, name: `Campaña ${id}`, status: "ENABLED", advertisingChannelType: "SEARCH" },
    campaignBudget: { amountMicros: "1000000", period: "DAILY" },
  };
}

function setup(campaigns: GoogleRow[]) {
  const simulator = new GoogleSimulator();
  const metricQueries: string[] = [];
  simulator.intercept = (call) => {
    if (call.url.hostname !== "googleads.googleapis.com") return undefined;
    const gaql = String(call.body.query);
    if (gaql.endsWith(" FROM customer"))
      return Response.json({
        results: [
          {
            customer: {
              id: ACCOUNT_ID,
              descriptiveName: "Cuenta ficticia",
              currencyCode: "MXN",
              timeZone: "America/Mexico_City",
              manager: false,
              status: "ENABLED",
            },
          },
        ],
      });
    if (gaql.includes("metrics.")) {
      metricQueries.push(gaql);
      return Response.json({ results: [] });
    }
    return Response.json({ results: / FROM campaign /.test(gaql) ? campaigns : [] });
  };
  return { provider: new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } }), metricQueries };
}

describe("contrato Absolute Top — capacidad por nivel antes de descargar métricas", () => {
  it("rechaza una expansión horaria mayor a 100.000 observaciones sin consultar métricas", async () => {
    // 596 campañas × 7 días × 24 horas = 100.128 observaciones de campaña.
    const { provider, metricQueries } = setup(Array.from({ length: 596 }, (_, i) => campaign(String(i + 1))));
    await expect(
      provider.getAbsoluteTop({
        account_id: ACCOUNT_ID,
        date_from: "2026-09-24",
        date_to: "2026-09-30",
        granularity: "hourly",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "Absolute Top excede el límite de observaciones de una lectura.",
    });
    expect(metricQueries).toEqual([]);
  });

  it("acepta exactamente el límite y conserva N/D en las entidades sin métricas", async () => {
    // 595 campañas × 7 × 24 = 99.960 observaciones: dentro del límite.
    const { provider, metricQueries } = setup(Array.from({ length: 595 }, (_, i) => campaign(String(i + 1))));
    const rows = await provider.getAbsoluteTop({
      account_id: ACCOUNT_ID,
      date_from: "2026-09-24",
      date_to: "2026-09-30",
      granularity: "hourly",
    });
    expect(rows).toHaveLength(99960);
    expect(metricQueries.length).toBe(2);
    expect(rows.every((row) => row.absolute_top_rate === null && row.impressions === null)).toBe(true);
  });
});
