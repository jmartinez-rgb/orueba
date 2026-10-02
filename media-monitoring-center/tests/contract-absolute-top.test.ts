import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { FileRecordStore } from "@/lib/records/store";
import { AbsoluteTopStore } from "@/lib/absolute-top/store";
import { reconcile } from "@/lib/alerts/incident-manager";
import { emptyAlertState } from "@/lib/alerts/types";
import { googleDomainsSchema } from "@/lib/domains/config";
import { evaluateAbsoluteTop, summarizeAbsoluteTop } from "@/lib/absolute-top/engine";
import { combineAbsoluteTopRun, getAbsoluteTopDashboard } from "@/lib/absolute-top/service";
import type { AbsoluteTopAudit, AbsoluteTopEvaluation, AbsoluteTopRow } from "@/lib/absolute-top/types";
import type { MonitoringRun } from "@/lib/monitoring/types";

// Contrato independiente: el único maestro es el JSON de la API; aquí no se copia otro mapa.
const config = googleDomainsSchema.parse(JSON.parse(readFileSync(new URL("../../unified-ads-api/src/config/google-ads-domains.json", import.meta.url), "utf8")));
const first = config.domains[0].accounts[0].customerId;

function row(rate: number | null, patch: Partial<AbsoluteTopRow> = {}): AbsoluteTopRow {
  return {
    level: "campaign", domain_id: null, domain_name: null, customer_id: first, account_id: first, account_name: "Cuenta ficticia",
    campaign_id: "c1", campaign_name: "Search ficticia", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null,
    date: "2026-10-01", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: "2026-10-02T06:00:00Z",
    absolute_top_rate: rate, top_of_page_rate: null, search_impression_share: null, search_lost_is_rank: null, search_lost_is_budget: null,
    impressions: 1000, clicks: 50, ctr: 5, cpc: 2, spend: 100, conversions: 1, bidding_strategy: null, daily_budget: null, share_bounds: {}, warnings: [], ...patch,
  };
}
function audit(rows: AbsoluteTopRow[], patch: Partial<AbsoluteTopAudit> = {}): AbsoluteTopAudit {
  return { version: 1, auditId: "a1", customerId: first, observedAt: "2026-10-02T06:00:00Z", from: "2026-10-01", to: "2026-10-01", granularity: "daily", coverage: "complete", rows, warnings: [], ...patch };
}
function run(rows: AbsoluteTopEvaluation[], runAt: string): MonitoringRun {
  const base: MonitoringRun = { runAt, timezone: "America/Mexico_City", businessDate: runAt.slice(0, 10), cutoffHour: 3, intervalHours: 2, comparisonDates: [], historyWeeks: 4, baseline: "mean", entities: [], anomalies: [], platformStatus: {} as MonitoringRun["platformStatus"], overall: "NORMAL", pacing: {} as MonitoringRun["pacing"], curves: {} as MonitoringRun["curves"], dataHealth: {} as MonitoringRun["dataHealth"], totalIncludes: [], totalCutoffHour: 3, platforms: ["google"] };
  return combineAbsoluteTopRun(base, { brand: "izzi", selectedDomain: "all", configured: true, available: true, lastAuditAt: rows[0]?.audit_at ?? null, domains: config.domains, policy: config.absoluteTop, rows, summaries: [], warnings: [], approximationNotice: "" });
}

describe("contrato Absolute Top — catálogo activo tras una extracción completa", () => {
  it("una campaña que sale del catálogo activo no deja el ponderado del dominio en N/D para siempre", () => {
    const before = audit([row(.8), row(.6, { campaign_id: "c2" })]);
    const old = evaluateAbsoluteTop(before, [], config);
    expect(summarizeAbsoluteTop(old, config)[0].weighted_absolute_top).toBeCloseTo(.7);
    // c2 se pausó: la API ya no la devuelve en el catálogo activo de una extracción completa.
    const next = audit([row(.8, { date: "2026-10-02", extracted_at: "2026-10-03T06:00:00Z" })], { auditId: "a2", observedAt: "2026-10-03T06:00:00Z", from: "2026-10-02", to: "2026-10-02" });
    const current = evaluateAbsoluteTop(next, [before], config, old);
    expect(current.map(r => r.campaign_id)).toEqual(["c1"]);
    expect(summarizeAbsoluteTop(current, config)[0]).toMatchObject({ campaigns: 1, weighted_absolute_top: .8 });
  });
  it("una extracción parcial o no disponible conserva visibles como N/D las entidades ausentes", () => {
    const before = audit([row(.8), row(.6, { campaign_id: "c2" })]);
    const old = evaluateAbsoluteTop(before, [], config);
    for (const coverage of ["partial", "unavailable"] as const) {
      const next = audit(coverage === "partial" ? [row(.8, { date: "2026-10-02" })] : [], { auditId: `a-${coverage}`, observedAt: "2026-10-03T06:00:00Z", from: "2026-10-02", to: "2026-10-02", coverage });
      const current = evaluateAbsoluteTop(next, [before], config, old);
      expect(current.map(r => r.campaign_id).sort()).toEqual(["c1", "c2"]);
      expect(current.find(r => r.campaign_id === "c2")).toMatchObject({ state: "insufficient", impressions: null, absolute_top_rate: null });
      expect(summarizeAbsoluteTop(current, config)[0].weighted_absolute_top).toBeNull();
    }
  });
});

describe("contrato Absolute Top — una auditoría de un período anterior no avanza el episodio", () => {
  const opened = audit([row(.5)]);
  const episode = evaluateAbsoluteTop(opened, [], config);
  // Backfill ejecutado después (observedAt más reciente) para una ventana anterior y sana.
  const backfill = audit([row(.9, { date: "2026-09-20", extracted_at: "2026-10-02T08:00:00Z" })], { auditId: "backfill", observedAt: "2026-10-02T08:00:00Z", from: "2026-09-20", to: "2026-09-20" });

  it("no confirma recuperación ni reinicia la persistencia con datos de una ventana anterior", () => {
    expect(episode[0]).toMatchObject({ state: "below", episode_open: true });
    const result = evaluateAbsoluteTop(backfill, [opened], config, episode)[0];
    expect(result.state).toBe("insufficient");
    expect(result.episode_open).toBe(true);
    expect(result.persistence).toMatchObject({ consecutive_audits: 1, first_detected_at: episode[0].persistence.first_detected_at });
    expect(result.last_valid_rate).toBe(.5);
    expect(result.diagnostics.join(" ")).toMatch(/período anterior/i);
    // Sin cobertura válida, la incidencia general no se reconcilia como recuperada.
    expect(run([result], "2026-10-02T08:30:00Z").absoluteTopCoverage).toEqual({});
  });
  it("también protege checkpoints guardados antes de registrar el fin de ventana", () => {
    const legacy = episode.map(item => { const copy: AbsoluteTopEvaluation = { ...item }; delete copy.checkpoint_end_at; return copy; });
    expect(legacy[0]).not.toHaveProperty("checkpoint_end_at");
    expect(evaluateAbsoluteTop(backfill, [opened], config, legacy)[0]).toMatchObject({ state: "insufficient", episode_open: true });
  });
  it("no presenta el ponderado de una ventana anterior como lectura vigente del dominio", () => {
    const result = evaluateAbsoluteTop(backfill, [opened], config, episode);
    expect(summarizeAbsoluteTop(result, config)[0].weighted_absolute_top).toBeNull();
  });
  it("dos backfills sucesivos tampoco avanzan: se conserva la ventana más reciente evaluada", () => {
    const one = evaluateAbsoluteTop(backfill, [opened], config, episode);
    const second = audit([row(.9, { date: "2026-09-27", extracted_at: "2026-10-02T09:00:00Z" })], { auditId: "backfill-2", observedAt: "2026-10-02T09:00:00Z", from: "2026-09-27", to: "2026-09-27" });
    const result = evaluateAbsoluteTop(second, [opened, backfill], config, one)[0];
    expect(result).toMatchObject({ state: "insufficient", episode_open: true, last_valid_rate: .5 });
  });
  it("la siguiente auditoría vigente sí puede confirmar recuperación y conserva la comparación anterior", () => {
    const one = evaluateAbsoluteTop(backfill, [opened], config, episode);
    const fresh = audit([row(.8, { date: "2026-10-02", extracted_at: "2026-10-03T06:00:00Z" })], { auditId: "fresh", observedAt: "2026-10-03T06:00:00Z", from: "2026-10-02", to: "2026-10-02" });
    const result = evaluateAbsoluteTop(fresh, [opened, backfill], config, one)[0];
    expect(result).toMatchObject({ state: "meets", episode_open: false });
    expect(result.persistence.consecutive_audits).toBe(0);
    expect(result.comparison.previous.rate).toBe(.5);
  });
});

describe("contrato Absolute Top — el corte usa el instante de extracción, no la recepción", () => {
  it("un total diario de un día abierto no bloquea la lectura horaria posterior del mismo día", () => {
    const openDay = audit([row(.8, { date: "2026-10-01", extracted_at: "2026-10-01T16:30:00Z" })], { auditId: "open-day", observedAt: "2026-10-01T16:30:00Z" });
    const first = evaluateAbsoluteTop(openDay, [], config);
    expect(first[0].state).toBe("insufficient");
    const hours = Array.from({ length: 24 }, (_, hour) => row(.8, { hour, impressions: hour <= 10 ? 100 : null, absolute_top_rate: hour <= 10 ? .8 : null, extracted_at: "2026-10-01T17:05:00Z" }));
    const result = evaluateAbsoluteTop(audit(hours, { auditId: "hourly", granularity: "hourly", observedAt: "2026-10-01T17:05:00Z" }), [openDay], config, first)[0];
    expect(result.warnings).not.toContain("AUDIT_PERIOD_PRECEDES_CHECKPOINT");
    expect(result).toMatchObject({ window_end_hour: 10, state: "meets" });
  });
  it("un día extraído antes de cerrar no se evalúa como día cerrado aunque la respuesta llegue después de medianoche", () => {
    // Extracción iniciada 23:59:30 hora de México del 2026-10-01; respuesta guardada a las 00:00:10 del 2026-10-02.
    const late = audit([row(.5, { extracted_at: "2026-10-02T05:59:30Z" })], { observedAt: "2026-10-02T06:00:10Z" });
    expect(evaluateAbsoluteTop(late, [], config)[0]).toMatchObject({ state: "insufficient", severity: "NORMAL" });
  });
  it("una hora en curso al extraer no entra al acumulado horario", () => {
    // Extracción 10:59:50 hora de México; recepción 11:00:05. Solo horas 0..9 están completas.
    const rows = Array.from({ length: 24 }, (_, hour) => row(hour <= 9 ? .8 : null, { hour, date: "2026-10-01", impressions: hour <= 9 ? 100 : null, extracted_at: "2026-10-01T16:59:50Z" }));
    const result = evaluateAbsoluteTop(audit(rows, { granularity: "hourly", observedAt: "2026-10-01T17:00:05Z" }), [], config)[0];
    expect(result).toMatchObject({ window_end_hour: 9, state: "meets", impressions: 1000 });
  });
});

describe("contrato Absolute Top — backfill extremo a extremo (almacén, tablero e incidencias)", () => {
  const directories: string[] = [];
  afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
  const opts = { settings: DEFAULT_SETTINGS, notify: true, whatsapp: { templateAlert: "fixture", templateRecovery: "fixture", templateLanguage: "es_MX" } };

  it("un backfill sano posterior no cierra la incidencia abierta ni muestra su ponderado como vigente", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contract-absolute-top-")); directories.push(dir);
    const store = new AbsoluteTopStore(new FileRecordStore(dir));
    const now = new Date("2026-10-02T09:00:00Z");
    await store.ingest(audit([row(.5, { extracted_at: "2026-10-02T06:00:00Z" })]), config, now);
    const opened = await getAbsoluteTopDashboard({ brand: "izzi", config, store, now, domainId: "all", allowedCustomerIds: [first] });
    const initial = reconcile(emptyAlertState(), run(opened.rows, now.toISOString()), opts);
    expect(initial.state.incidents.filter(incident => incident.resolvedAt === null)).toHaveLength(1);
    const later = new Date("2026-10-02T10:00:00Z");
    await store.ingest(audit([row(.95, { date: "2026-09-20", extracted_at: "2026-10-02T09:30:00Z" })], { auditId: "backfill", observedAt: "2026-10-02T09:30:00Z", from: "2026-09-20", to: "2026-09-20" }), config, later);
    const dashboard = await getAbsoluteTopDashboard({ brand: "izzi", config, store, now: later, domainId: "all", allowedCustomerIds: [first] });
    expect(dashboard.rows[0]).toMatchObject({ state: "insufficient", episode_open: true, last_valid_rate: .5 });
    expect(dashboard.summaries[0].weighted_absolute_top).toBeNull();
    const after = reconcile(initial.state, run(dashboard.rows, later.toISOString()), opts);
    expect(after.state.incidents.filter(incident => incident.resolvedAt === null)).toHaveLength(1);
  });
});
