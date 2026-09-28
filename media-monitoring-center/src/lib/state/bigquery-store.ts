import "server-only";
import type { BudgetRow } from "@/lib/types";
import type { Alert, AlertState, AlertStatus, Incident, IncidentStatus, NotificationRecord } from "@/lib/alerts/types";
import { applyAlertStatus } from "@/lib/alerts/incident-manager";
import { getEnv } from "@/lib/config/env";
import { fullTableName, getBigQuery, runQuery } from "@/lib/bigquery/client";
import type { BigQueryMapping } from "@/lib/bigquery/mapping";
import { logger, recordIntegrationEvent } from "@/lib/logging/logger";
import type { RunSummary, StateStore, UserOverrides } from "./store";

/**
 * Estado operativo en BigQuery con tablas propias de la app (append-only).
 * Cada cambio inserta una nueva versión de la fila; la lectura toma la última por id.
 * DDL sugerido en docs/BIGQUERY.md.
 */

type Row = Record<string, unknown>;

export class BigQueryStateStore implements StateStore {
  readonly kind = "bigquery" as const;
  constructor(private readonly tables: BigQueryMapping["state"]) {}

  private dataset() {
    return getEnv().bigquery.stateDataset;
  }

  private table(name: string) {
    return fullTableName(name, this.dataset());
  }

  private async insert(tableName: string, rows: Row[]) {
    if (rows.length === 0) return;
    const started = Date.now();
    try {
      const bq = await getBigQuery();
      await bq.dataset(this.dataset()!).table(tableName).insert(rows, { ignoreUnknownValues: true });
      recordIntegrationEvent({ target: "bigquery", action: `insert:${tableName}`, ok: true, durationMs: Date.now() - started, detail: `${rows.length} filas` });
    } catch (err) {
      recordIntegrationEvent({ target: "bigquery", action: `insert:${tableName}`, ok: false, durationMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async latest<T>(tableName: string, days: number): Promise<T[]> {
    const { rows } = await runQuery<Row>(
      `state_${tableName}`,
      `SELECT payload FROM ${this.table(tableName)}
       WHERE updated_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
       QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1`,
      { days },
      { days: "INT64" },
    );
    return rows.map((r) => JSON.parse(String(r.payload)) as T);
  }

  async loadAlertState(): Promise<AlertState> {
    const [alerts, incidents, notifications] = await Promise.all([
      this.latest<Alert>(this.tables.alerts, 3),
      this.latest<Incident>(this.tables.incidents, 14),
      this.latest<NotificationRecord>(this.tables.notifications, 3),
    ]);
    const maxSeq = (ids: string[]) => ids.reduce((m, id) => Math.max(m, Number(id.split("-")[1]) || 0), 0);
    return {
      alerts,
      incidents,
      notifications,
      seq: {
        alert: maxSeq(alerts.map((a) => a.id)),
        incident: maxSeq(incidents.map((i) => i.id)),
        notification: maxSeq(notifications.map((n) => n.id)),
      },
    };
  }

  async saveAlertState(state: AlertState): Promise<void> {
    const now = new Date().toISOString();
    // Solo se escriben filas tocadas en esta corrida (vivas o resueltas recientemente).
    const recent = (iso: string | null) => iso !== null && Date.now() - Date.parse(iso) < 3 * 3600 * 1000;
    const alerts = state.alerts.filter((a) => a.resolvedAt === null || recent(a.resolvedAt));
    const incidents = state.incidents.filter((i) => i.resolvedAt === null || recent(i.resolvedAt));
    await Promise.all([
      this.insert(
        this.tables.alerts,
        alerts.map((a) => ({ id: a.id, fingerprint: a.fingerprint, platform: a.platform, severity: a.severity, status: a.status, detected_at: a.detectedAt, resolved_at: a.resolvedAt, updated_at: now, payload: JSON.stringify(a) })),
      ),
      this.insert(
        this.tables.incidents,
        incidents.map((i) => ({ id: i.id, fingerprint: i.fingerprint, platform: i.platform, severity: i.severity, status: i.status, started_at: i.startedAt, resolved_at: i.resolvedAt, updated_at: now, payload: JSON.stringify(i) })),
      ),
    ]);
    logger.info("state.saved", { alerts: alerts.length, incidents: incidents.length });
  }

  async saveNotifications(list: NotificationRecord[]): Promise<void> {
    const now = new Date().toISOString();
    await this.insert(
      this.tables.notifications,
      list.map((n) => ({ id: n.id, incident_id: n.incidentId, platform: n.platform, kind: n.kind, severity: n.severity, channel: n.channel, status: n.status, created_at: n.createdAt, updated_at: now, payload: JSON.stringify(n) })),
    );
  }

  async saveRun(run: RunSummary): Promise<void> {
    await this.insert(this.tables.runs, [{ id: run.id, business_date: run.businessDate, run_at: run.at, trigger: run.trigger, overall: run.overall, updated_at: new Date().toISOString(), payload: JSON.stringify(run) }]);
  }

  async listRuns(date: string): Promise<RunSummary[]> {
    const { rows } = await runQuery<Row>(
      "state_runs",
      `SELECT payload FROM ${this.table(this.tables.runs)} WHERE business_date = @date ORDER BY run_at`,
      { date },
      { date: "DATE" },
    );
    return rows.map((r) => JSON.parse(String(r.payload)) as RunSummary);
  }

  async getOverrides(): Promise<UserOverrides> {
    // En BigQuery los cambios de usuario se guardan como nuevas versiones de alertas/incidentes.
    const budgets = await this.latest<BudgetRow & { id: string }>("monitoring_budget_overrides", 400).catch(() => []);
    return { alerts: {}, incidents: {}, budgets };
  }

  async setAlertStatus(id: string, status: AlertStatus, by: string): Promise<void> {
    const state = await this.loadAlertState();
    const next = applyAlertStatus(state, id, status, new Date().toISOString());
    logger.info("alert.status", { id, status, by });
    await this.saveAlertState(next);
  }

  async updateIncident(id: string, patch: { owner?: string | null; status?: IncidentStatus; note?: string }, by: string): Promise<void> {
    const state = await this.loadAlertState();
    const inc = state.incidents.find((i) => i.id === id);
    if (!inc) return;
    const now = new Date().toISOString();
    if (patch.owner !== undefined) inc.owner = patch.owner;
    if (patch.status) inc.status = patch.status;
    if (patch.note) inc.notes.push({ at: now, author: by, text: patch.note });
    await this.insert(this.tables.incidents, [
      { id: inc.id, fingerprint: inc.fingerprint, platform: inc.platform, severity: inc.severity, status: inc.status, started_at: inc.startedAt, resolved_at: inc.resolvedAt, updated_at: now, payload: JSON.stringify(inc) },
    ]);
  }

  async loadSettingsPatch(): Promise<unknown> {
    const rows = await this.latest<{ id: string; patch: unknown }>(this.tables.settings, 3650);
    return rows.find((r) => r.id === "current")?.patch ?? null;
  }

  async saveSettingsPatch(patch: unknown, by: string): Promise<void> {
    await this.insert(this.tables.settings, [{ id: "current", updated_at: new Date().toISOString(), updated_by: by, payload: JSON.stringify({ id: "current", patch }) }]);
  }

  async setBudget(row: BudgetRow): Promise<void> {
    const id = [row.month, row.level, row.platform ?? "", row.accountId ?? "", row.campaignId ?? ""].join("|");
    await this.insert("monitoring_budget_overrides", [{ id, updated_at: new Date().toISOString(), payload: JSON.stringify({ ...row, id }) }]);
  }
}
