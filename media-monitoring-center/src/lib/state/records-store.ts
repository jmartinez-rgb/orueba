import "server-only";
import type { BudgetRow } from "@/lib/types";
import type { AlertState, AlertStatus, IncidentStatus, NotificationRecord } from "@/lib/alerts/types";
import { emptyAlertState } from "@/lib/alerts/types";
import { getRecordStore } from "@/lib/records/store";
import type { RunSummary, StateStore, UserOverrides } from "./store";

/**
 * Estado operativo (alertas, incidentes, notificaciones, corridas y cambios de usuarios) en el
 * almacén de registros: Netlify Blobs en producción, archivos en local. Se usa cuando los datos
 * vienen de Google Sheets (no hay tablas de BigQuery donde guardarlo). No guarda métricas.
 */


/** Lo resuelto hace más de estos días se descarta para que el estado no crezca sin límite. */
const KEEP_DAYS = 45;

function prune(state: AlertState): AlertState {
  const limit = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  return {
    ...state,
    alerts: state.alerts.filter((a) => a.resolvedAt === null || a.resolvedAt >= limit),
    incidents: state.incidents.filter((i) => i.resolvedAt === null || i.resolvedAt >= limit),
    notifications: state.notifications.filter((n) => n.createdAt >= limit),
  };
}

export class RecordsStateStore implements StateStore {
  readonly kind = "records" as const;
  private readonly STATE_KEY: string;
  private readonly OVERRIDES_KEY: string;

  /** izzi usa "state/…" (como siempre); Sky usa "state/sky/…". */
  constructor(private readonly prefix = "state/") {
    this.STATE_KEY = `${prefix}alerts`;
    this.OVERRIDES_KEY = `${prefix}overrides`;
  }

  private runsKey(date: string) {
    return `${this.prefix}runs/${date}`;
  }

  private get store() {
    return getRecordStore();
  }

  async loadAlertState(): Promise<AlertState> {
    return (await this.store.get<AlertState>(this.STATE_KEY)) ?? emptyAlertState();
  }

  async saveAlertState(state: AlertState): Promise<void> {
    await this.store.set(this.STATE_KEY, prune(state));
  }

  async saveNotifications(list: NotificationRecord[]): Promise<void> {
    if (!list.length) return;
    const state = await this.loadAlertState();
    for (const n of list) {
      const i = state.notifications.findIndex((x) => x.id === n.id);
      if (i >= 0) state.notifications[i] = n;
      else state.notifications.push(n);
    }
    await this.saveAlertState(state);
  }

  async saveRun(run: RunSummary): Promise<void> {
    const list = (await this.store.get<RunSummary[]>(this.runsKey(run.businessDate))) ?? [];
    await this.store.set(this.runsKey(run.businessDate), [...list.filter((r) => r.id !== run.id), run].slice(-60));
  }

  async listRuns(date: string): Promise<RunSummary[]> {
    return (await this.store.get<RunSummary[]>(this.runsKey(date))) ?? [];
  }

  async getOverrides(): Promise<UserOverrides> {
    return (await this.store.get<UserOverrides>(this.OVERRIDES_KEY)) ?? { alerts: {}, incidents: {}, budgets: [] };
  }

  private async updateOverrides(fn: (o: UserOverrides) => void): Promise<void> {
    const o = await this.getOverrides();
    fn(o);
    await this.store.set(this.OVERRIDES_KEY, o);
  }

  async setAlertStatus(id: string, status: AlertStatus, by: string): Promise<void> {
    await this.updateOverrides((o) => {
      o.alerts[id] = { status, at: new Date().toISOString(), by };
    });
  }

  async updateIncident(id: string, patch: { owner?: string | null; status?: IncidentStatus; note?: string }, by: string): Promise<void> {
    await this.updateOverrides((o) => {
      const cur = o.incidents[id] ?? {};
      if (patch.owner !== undefined) cur.owner = patch.owner;
      if (patch.status) cur.status = patch.status;
      if (patch.note) cur.notes = [...(cur.notes ?? []), { at: new Date().toISOString(), author: by, text: patch.note }];
      o.incidents[id] = cur;
    });
  }

  async setBudget(row: BudgetRow): Promise<void> {
    await this.updateOverrides((o) => {
      const same = (b: BudgetRow) => b.month === row.month && b.level === row.level && b.platform === row.platform && b.accountId === row.accountId && b.campaignId === row.campaignId;
      o.budgets = [...o.budgets.filter((b) => !same(b)), row];
    });
  }
}
