import { describe, expect, it } from "vitest";
import { MetaProvider } from "../src/providers/meta/index.js";
import { SpotifyProvider } from "../src/providers/spotify/index.js";
import { XProvider } from "../src/providers/x/index.js";
import { performanceByAccount, runChecks, verificationWorkbook } from "../src/verification/real-check.js";
import type { NormalizedPerformance } from "../src/types/normalized.js";
import { MetaSimulator } from "./meta-simulator.js";

function meta() {
  const sim = new MetaSimulator();
  sim.handler = (url) => {
    const fields = url.searchParams.get("fields") ?? "";
    if (url.pathname.endsWith("act_111/campaigns") && fields.includes("daily_budget"))
      return MetaSimulator.json({
        data: [{ id: "333", name: "Campaña de prueba", effective_status: "ACTIVE", daily_budget: "50000" }],
      });
    if (url.pathname.endsWith("act_111") && fields.includes("spend_cap"))
      return MetaSimulator.json({ account_status: 1, spend_cap: "0" });
    if (fields.includes("issues_info")) return MetaSimulator.json({ data: [] });
    return undefined;
  };
  return new MetaProvider({ ...sim.env, META_AD_ACCOUNT_IDS: "111" }, { fetch: sim.fetch });
}

describe("verificación real (con simulador)", () => {
  it("recorre estado, cuentas, campañas, presupuestos, salud y rendimiento, y omite lo no configurado", async () => {
    const seen: string[] = [];
    const r = await runChecks([meta(), new SpotifyProvider({}), new XProvider({})], "2026-09-29", (row) =>
      seen.push(`${row.platform}:${row.check}:${row.result}`),
    );
    expect(seen).toEqual([
      "meta:estado:OK",
      "meta:cuentas:OK",
      "meta:campañas:OK",
      "meta:presupuestos:OK",
      "meta:salud:OK",
      "meta:rendimiento:OK",
      "spotify:estado:OMITIDO",
      "x:estado:OMITIDO",
    ]);
    expect(r.budgets).toHaveLength(1);
    expect(r.performance.length).toBeGreaterThan(0);
    const sheets = verificationWorkbook(r, "1/10/2026");
    expect(sheets.map((s) => s.name)).toEqual([
      "Resumen",
      "Rendimiento por cuenta",
      "Presupuestos",
      "Salud de entrega",
      "Avisos",
      "Criterios",
    ]);
    for (const s of sheets) for (const row of s.rows) expect(row.length).toBe(s.columns.length);
    // Nada sensible del simulador termina en el libro.
    expect(JSON.stringify(sheets)).not.toMatch(/meta-test-token-private|meta-test-app-secret/);
  });

  it("los totales por cuenta nunca mezclan monedas y cuentan filas sin acción principal", () => {
    const row = (p: Partial<NormalizedPerformance>) =>
      ({
        platform: "meta",
        account_id: "1",
        account_name: "A",
        campaign_id: "c",
        currency: "MXN",
        spend: 10,
        impressions: 100,
        clicks: 5,
        conversions: null,
        ...p,
      }) as NormalizedPerformance;
    const out = performanceByAccount([
      row({}),
      row({ campaign_id: "d", conversions: 2 }),
      row({ currency: "USD", spend: 3 }),
    ]);
    expect(out.map((a) => [a.currency, a.spend, a.conversions, a.nullConversions, a.campaigns.size])).toEqual([
      ["MXN", 20, 2, 1, 2],
      ["USD", 3, 0, 1, 1],
    ]);
  });
});
