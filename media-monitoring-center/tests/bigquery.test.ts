import { describe, expect, it } from "vitest";
import { parseMapping } from "@/lib/bigquery/mapping";
import { hourlyQuery, normalizedSelect, snapshotQuery } from "@/lib/bigquery/queries";
import { snapshotsToHourly, inferObjective } from "@/lib/bigquery/bigquery-source";

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
});
