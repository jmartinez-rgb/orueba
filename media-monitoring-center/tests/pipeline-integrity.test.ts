import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { UnifiedDataSource, reportInstant } from "@/lib/unified/source";
import { performanceSchema, type ApiPerformance, type UnifiedScope } from "@/lib/unified/schema";
import { BrandScopedSource } from "@/lib/data/brand-source";
import { CurrencyConvertedSource } from "@/lib/data/currency";
import { getCompare, getHistorical } from "@/lib/services/analysis";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { BRANDS } from "@/lib/brands";
import { businessDate, zonedParts } from "@/lib/time/tz";

const now = new Date("2026-10-05T18:00:00Z");
const date = "2026-10-01";
const a: UnifiedScope = { platform: "google", accountId: "a", brand: "izzi", currency: "MXN" };
const b: UnifiedScope = { ...a, accountId: "b" };
let directory: string;
let store: UnifiedSnapshotStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "pipeline-integrity-")); store = new UnifiedSnapshotStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function row(scope: UnifiedScope, hour: number | null, spend = 10): ApiPerformance {
  return performanceSchema.parse({ platform: scope.platform, account_id: scope.accountId, campaign_id: "shared", date, hour,
    currency: scope.currency, source_timezone: "America/Mexico_City", spend, clicks: 2, impressions: 20,
    extracted_at: now.toISOString(), raw_metrics: {} });
}
async function catalog(scope: UnifiedScope) {
  await store.saveCatalog({ version: 1, scope, extractedAt: now.toISOString(),
    account: { platform: scope.platform, account_id: scope.accountId, account_name: "Nombre neutro", currency: scope.currency, timezone: "America/Mexico_City" },
    campaigns: [{ platform: scope.platform, account_id: scope.accountId, campaign_id: "shared", campaign_name: "Campaña común", campaign_status: "active", source_status: null, objective: null }] });
}
async function save(scope: UnifiedScope, granularity: "daily" | "hourly", rows: ApiPerformance[]) {
  await store.savePartition({ version: 1, scope, date, granularity, rows, extractedAt: now.toISOString() });
}
const direct = (scopes = [a, b]) => new UnifiedDataSource({ store, accounts: scopes, timezone: "America/Mexico_City", clock: () => now });
const converted = (scopes = [a, b]) => new CurrencyConvertedSource(new BrandScopedSource(direct(scopes), "izzi"), { rates: { "2026-10": 20 }, accountCurrency: {} });

describe("cobertura de cuentas en el histórico de APIs directas", () => {
  it("conserva el dato de una campaña pero deja desconocido el total si falta otra cuenta mapeada", async () => {
    await catalog(a); await catalog(b); await save(a, "daily", [row(a, null)]);
    const src = converted();
    const campaigns = await src.getDaily({ from: date, to: date, level: "campaign" });
    expect(campaigns).toHaveLength(1); expect(campaigns[0].metrics.spend).toBe(10);
    const total = await src.getDaily({ from: date, to: date, level: "platform" });
    expect(total).toHaveLength(1); expect(total[0].metrics.spend).toBeNull(); expect(total[0].metrics.clicks).toBeNull();
  });

  it("un cero confirmado no convierte una cuenta ausente en cero", async () => {
    await catalog(a); await catalog(b); await save(a, "daily", [row(a, null, 0)]);
    const rows = await converted().getDaily({ from: date, to: date, level: "account" });
    expect(rows.find(r => r.accountId === "google:a")?.metrics.spend).toBe(0);
    expect(rows.find(r => r.accountId === "google:b")?.metrics.spend).toBeNull();
    expect((await converted().getDaily({ from: date, to: date, level: "platform" }))[0].metrics.spend).toBeNull();
  });

  it("la hora ausente en una sola cuenta invalida solo esa hora consolidada", async () => {
    await catalog(a); await catalog(b);
    await save(a, "hourly", Array.from({ length: 24 }, (_, hour) => row(a, hour)));
    await save(b, "hourly", Array.from({ length: 24 }, (_, hour) => row(b, hour)).filter(r => r.hour !== 11));
    const total = await converted().getHourly({ dates: [date], level: "platform" });
    expect(total).toHaveLength(24);
    expect(total.find(r => r.hour === 11)?.metrics.spend).toBeNull();
    expect(total.filter(r => r.hour !== 11).every(r => r.metrics.spend === 20)).toBe(true);
  });

  it("una plataforma totalmente ausente tampoco desaparece del total de marca", async () => {
    const meta = { ...b, platform: "meta" as const };
    await catalog(a); await catalog(meta); await save(a, "daily", [row(a, null)]);
    const rows = await converted([a, meta]).getDaily({ from: date, to: date, level: "platform" });
    expect(rows.find(r => r.platform === "google")?.metrics.spend).toBe(10);
    expect(rows.find(r => r.platform === "meta")?.metrics.spend).toBeNull();
    const result = await getHistorical({ mode: "unified", source: converted([a, meta]), settings: DEFAULT_SETTINGS, brandInfo: BRANDS.izzi }, { today: "2026-10-02", weeks: 1, cutoffHour: 24, metric: "spend" });
    expect(result.days.find(day => day.date === date)).toMatchObject({ google: 10, meta: null, total: null });
  });

  it("una cuenta de Sky ausente no contamina los totales de izzi en una plataforma compartida", async () => {
    const sky = { ...b, brand: "sky" as const };
    await catalog(a); await catalog(sky); await save(a, "daily", [row(a, null)]);
    const rows = await converted([a, sky]).getDaily({ from: date, to: date, level: "platform" });
    expect(rows).toHaveLength(1); expect(rows[0].metrics.spend).toBe(10);
  });

  it("la conversión USD→MXN conserva el desconocido y un cero confirmado de la otra cuenta", async () => {
    const usd = { ...b, currency: "USD" as const };
    await catalog(a); await catalog(usd); await save(a, "daily", [row(a, null)]);
    expect((await converted([a, usd]).getDaily({ from: date, to: date, level: "platform" }))[0].metrics.spend).toBeNull();
    await save(usd, "daily", [row(usd, null, 0)]);
    expect((await converted([a, usd]).getDaily({ from: date, to: date, level: "platform" }))[0].metrics.spend).toBe(10);
  });

  it.each(["campaign", "account", "strategy"] as const)("Comparar por %s conserva el total desconocido si falta una cuenta", async dimension => {
    await catalog(a); await catalog(b); await save(a, "hourly", Array.from({ length: 24 }, (_, hour) => row(a, hour)));
    const result = await getCompare({ mode: "unified", source: converted(), settings: DEFAULT_SETTINGS, brandInfo: BRANDS.izzi },
      { date, cutoffHour: 24, weeksBack: [], customDates: [], metric: "spend", dimension, platform: "all", focus: null });
    expect(result.rows[0].values).toEqual([240]); expect(result.total.values).toEqual([null]);
    expect(result.series.every(point => point.c0 === null)).toBe(true);
  });

  it("no crea cifras, fechas ni ceros cuando todas las cuentas están ausentes", async () => {
    await catalog(a); await catalog(b);
    expect(await converted().getDaily({ from: date, to: date, level: "platform" })).toEqual([]);
    expect(await converted().getHourly({ dates: [date], level: "account" })).toEqual([]);
  });

  it("propaga la cobertura de cada cuenta antes de combinar resultados directos y filtrados por marca", async () => {
    const meta = { ...b, platform: "meta" as const }, sky = { ...meta, accountId: "sky", brand: "sky" as const };
    await catalog(a); await catalog(meta); await catalog(sky); await save(a, "daily", [row(a, null)]);
    const rows = await converted([a, meta, sky]).getDaily({ from: date, to: date, level: "platform" });
    expect(rows.find(r => r.platform === "google")?.metrics.spend).toBe(10);
    expect(rows.find(r => r.platform === "meta")?.metrics.spend).toBeNull();
  });
});

describe("relojes horarios del proveedor", () => {
  it("conserva cada instante y suma al reasignar UTC a México en cruces de mes y año", async () => {
    await catalog(a);
    for (const sourceDate of ["2024-02-29", "2026-01-01", "2026-10-01"]) {
      const rows = Array.from({ length: 24 }, (_, hour) => ({ ...row(a, hour), date: sourceDate, source_timezone: "UTC", spend: hour + 1 }));
      await store.savePartition({ version: 1, scope: a, date: sourceDate, granularity: "hourly", extractedAt: now.toISOString(), rows });
      const wanted = [...new Set(rows.map(r => businessDate(reportInstant(r, r.hour!), "America/Mexico_City")))];
      const actual = await direct([a]).getHourly({ dates: wanted, level: "campaign" });
      expect(actual).toHaveLength(24); expect(actual.reduce((sum, r) => sum + r.metrics.spend!, 0)).toBe(300);
      for (const r of rows) { const instant = reportInstant(r, r.hour!); expect(actual.some(actual => actual.date === businessDate(instant, "America/Mexico_City") && actual.hour === zonedParts(instant, "America/Mexico_City").hour && actual.metrics.spend === r.spend)).toBe(true); }
    }
  });

  it("el offset histórico explícito de X conserva horas repetidas de DST sin asumir el IANA actual", () => {
    const before = { ...row(a, 1), date: "2026-11-01", source_timezone: "America/New_York", raw_metrics: { report_utc_offset_minutes: -240 } };
    const after = { ...before, raw_metrics: { report_utc_offset_minutes: -300 } };
    expect(reportInstant(after, 1).getTime() - reportInstant(before, 1).getTime()).toBe(3_600_000);
    expect(zonedParts(reportInstant(before, 1), "America/Mexico_City").hour).not.toBe(zonedParts(reportInstant(after, 1), "America/Mexico_City").hour);
  });
});
