import { describe, expect, it } from "vitest";
import { parseMapping } from "@/lib/bigquery/mapping";
import { executionControlQuery, fxRatesQuery, hourlyQuery, normalizedSelect, snapshotQuery } from "@/lib/bigquery/queries";
import { currencyOf, snapshotsToHourly, inferObjective } from "@/lib/bigquery/bigquery-source";
import { readFileSync } from "node:fs";
import path from "node:path";

const resolve = (t: string) => `\`proj.ds.${t}\``;
const mappingJson = JSON.stringify({
  metricSources: [
    {
      name: "hourly",
      table: "ads_hourly",
      shape: "hourly",
      partition: { field: "report_date", type: "DATE" },
      fields: { date: "report_date", hour: "report_hour", platform: "source", accountId: "account_id", campaignId: "campaign_id", campaignName: "campaign_name", spend: "cost", conversions: "conversions" },
      platformValues: { fb: "meta" },
    },
  ],
});

describe("capa BigQuery configurable", () => {
  it("acepta un mapeo válido y rechaza inyecciones", () => {
    expect(parseMapping(mappingJson).mapping).not.toBeNull();
    const bad = JSON.parse(mappingJson);
    bad.metricSources[0].fields.spend = "cost; DROP TABLE x";
    expect(parseMapping(JSON.stringify(bad)).mapping).toBeNull();
    expect(parseMapping(undefined).errors[0]).toMatch(/mapeo de BigQuery/);
  });

  it("solo selecciona columnas mapeadas, con filtro de partición y NULL para métricas sin mapear", () => {
    const m = parseMapping(mappingJson).mapping!;
    const sql = normalizedSelect(m.metricSources[0], resolve, "dates");
    expect(sql).toContain("report_date IN UNNEST(@partition_dates)");
    expect(sql).toContain("CAST(cost AS FLOAT64) AS spend");
    expect(sql).toContain("CAST(NULL AS FLOAT64) AS whatsapp");
    expect(sql).toContain("WHEN 'fb' THEN 'meta'");
    expect(sql).not.toMatch(/SELECT \*\s+FROM `/);
    const q = hourlyQuery(m.metricSources, resolve, "platform", true);
    expect(q).toContain("platform IN UNNEST(@platforms)");
    expect(q).toContain("SUM(spend) AS spend");
  });

  it("cortes acumulados → incrementos horarios (sin duplicar el acumulado)", () => {
    const m = JSON.parse(mappingJson);
    m.metricSources[0].shape = "cumulative_snapshot";
    m.metricSources[0].fields.timestamp = "snapshot_ts";
    const parsed = parseMapping(JSON.stringify(m)).mapping!;
    expect(snapshotQuery(parsed.metricSources, resolve, false)).toContain("QUALIFY ROW_NUMBER()");
    const rows = snapshotsToHourly([
      { date: "2026-09-28", cover_h: 10, platform: "meta", account_id: "a", campaign_id: "c", spend: 1000, conversions: 10 },
      { date: "2026-09-28", cover_h: 12, platform: "meta", account_id: "a", campaign_id: "c", spend: 1400, conversions: 14 },
    ]);
    const total = rows.reduce((a, r) => a + (r.metrics.spend ?? 0), 0);
    expect(total).toBeCloseTo(1400);
    expect(rows.filter((r) => r.hour >= 10).reduce((a, r) => a + (r.metrics.spend ?? 0), 0)).toBeCloseTo(400);
  });

  it("infiere el objetivo desde el nombre de campaña", () => {
    expect(inferObjective("IZZI_CAPI WhatsApp_Nacional", null)).toBe("PURCHASES");
    expect(inferObjective("IZZI_MSG_WhatsApp_CDMX", null)).toBe("WHATSAPP");
    expect(inferObjective("izzi_Search_Competencia_Leads", null)).toBe("LEADS");
  });

  it("los mapeos de ejemplo de config/ son válidos", () => {
    for (const file of ["bigquery.mapping.example.json", "bigquery.mapping.hourly-example.json"]) {
      const res = parseMapping(readFileSync(path.join(process.cwd(), "config", file), "utf8"));
      expect(res.errors, file).toEqual([]);
      expect(res.mapping?.executionControl, file).toBeTruthy();
      expect(res.mapping?.fxRates, file).toBeTruthy();
    }
  });

  it("control de ejecución y tipo de cambio toleran celdas mal capturadas", () => {
    const m = parseMapping(readFileSync(path.join(process.cwd(), "config", "bigquery.mapping.hourly-example.json"), "utf8")).mapping!;
    const ec = m.executionControl;
    if (ec?.type !== "bigquery") throw new Error("se esperaba executionControl de BigQuery");
    const sql = executionControlQuery(ec, resolve);
    expect(sql).toContain("CAST(ultima_ejecucion AS STRING) AS last_run_at"); // la zona horaria se resuelve en la app
    expect(sql).toContain("SAFE_CAST(filas AS INT64)");
    expect(fxRatesQuery(m.fxRates!, resolve)).toContain("SAFE_CAST(REPLACE(CAST(tasa AS STRING), ',', '.') AS FLOAT64)");
  });

  it("normaliza la moneda de la cuenta", () => {
    for (const v of ["USD", "usd", " USD ", "US$", "Dólares", "dollar"]) expect(currencyOf(v), String(v)).toBe("USD");
    for (const v of ["MXN", "mxn", "Pesos", "", null, undefined]) expect(currencyOf(v), String(v)).toBe("MXN");
  });
});
