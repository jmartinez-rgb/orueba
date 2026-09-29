import type { BudgetRow, DataState, PlatformId, Severity } from "@/lib/types";
import type { AlertState, AlertStatus, IncidentStatus, NotificationRecord } from "@/lib/alerts/types";
import { emptyAlertState } from "@/lib/alerts/types";

/**
 * Persistencia del estado operativo (alertas, incidentes, notificaciones, corridas y
 * cambios hechos por usuarios). En producción vive en BigQuery (tablas propias de la app);
 * en MOCK MODE vive en memoria del servidor.
 */

export interface RunSummary {
  id: string;
  at: string;
  businessDate: string;
  cutoffHour: number;
  trigger: "schedule" | "manual" | "replay";
  overall: Severity;
  platforms: Record<PlatformId, { severity: Severity; dataState: DataState }>;
  anomalies: number;
  openIncidents: number;
  notifications: number;
  durationMs: number;
}

export interface UserOverrides {
  alerts: Record<string, { status: AlertStatus; at: string; by: string }>;
  incidents: Record<string, { owner?: string | null; status?: IncidentStatus; notes?: Array<{ at: string; author: string; text: string }> }>;
  budgets: BudgetRow[];
}

export interface StateStore {
  readonly kind: "memory" | "bigquery" | "records";
  loadAlertState(): Promise<AlertState>;
  saveAlertState(state: AlertState): Promise<void>;
  saveNotifications(list: NotificationRecord[]): Promise<void>;
  saveRun(run: RunSummary): Promise<void>;
  listRuns(date: string): Promise<RunSummary[]>;
  getOverrides(): Promise<UserOverrides>;
  setAlertStatus(id: string, status: AlertStatus, by: string): Promise<void>;
  updateIncident(id: string, patch: { owner?: string | null; status?: IncidentStatus; note?: string }, by: string): Promise<void>;
  setBudget(row: BudgetRow): Promise<void>;
  /** Configuración compartida (solo BigQuery; en mock se guarda en una cookie por navegador). */
  loadSettingsPatch?(): Promise<unknown>;
  saveSettingsPatch?(patch: unknown, by: string): Promise<void>;
}

interface MemoryData {
  state: AlertState;
  runs: RunSummary[];
  overrides: UserOverrides;
}

const g = globalThis as unknown as { __immcMemoryStores?: Map<string, MemoryData> };

function memoryOf(namespace: string): MemoryData {
  g.__immcMemoryStores ??= new Map();
  let m = g.__immcMemoryStores.get(namespace);
  if (!m) {
    m = { state: emptyAlertState(), runs: [], overrides: { alerts: {}, incidents: {}, budgets: [] } };
    g.__immcMemoryStores.set(namespace, m);
  }
  return m;
}

/** Almacén en memoria (mock y desarrollo). Se reinicia con cada arranque en frío del servidor. */
export class MemoryStateStore implements StateStore {
  readonly kind = "memory" as const;
  /** Un espacio por marca (izzi y Sky no comparten alertas ni incidentes). */
  constructor(private readonly namespace = "izzi") {}

  async loadAlertState() {
    return structuredClone(memoryOf(this.namespace).state);
  }
  async saveAlertState(state: AlertState) {
    memoryOf(this.namespace).state = structuredClone(state);
  }
  async saveNotifications(list: NotificationRecord[]) {
    const m = memoryOf(this.namespace);
    for (const n of list) {
      const i = m.state.notifications.findIndex((x) => x.id === n.id);
      if (i >= 0) m.state.notifications[i] = n;
      else m.state.notifications.push(n);
    }
  }
  async saveRun(run: RunSummary) {
    const m = memoryOf(this.namespace);
    m.runs = [...m.runs.filter((r) => r.id !== run.id), run].slice(-200);
  }
  async listRuns(date: string) {
    return memoryOf(this.namespace).runs.filter((r) => r.businessDate === date);
  }
  async getOverrides() {
    return structuredClone(memoryOf(this.namespace).overrides);
  }
  async setAlertStatus(id: string, status: AlertStatus, by: string) {
    memoryOf(this.namespace).overrides.alerts[id] = { status, at: new Date().toISOString(), by };
  }
  async updateIncident(id: string, patch: { owner?: string | null; status?: IncidentStatus; note?: string }, by: string) {
    const cur = memoryOf(this.namespace).overrides.incidents[id] ?? {};
    if (patch.owner !== undefined) cur.owner = patch.owner;
    if (patch.status) cur.status = patch.status;
    if (patch.note) cur.notes = [...(cur.notes ?? []), { at: new Date().toISOString(), author: by, text: patch.note }];
    memoryOf(this.namespace).overrides.incidents[id] = cur;
  }
  async setBudget(row: BudgetRow) {
    const m = memoryOf(this.namespace);
    const same = (b: BudgetRow) => b.month === row.month && b.level === row.level && b.platform === row.platform && b.accountId === row.accountId && b.campaignId === row.campaignId;
    m.overrides.budgets = [...m.overrides.budgets.filter((b) => !same(b)), row];
  }
}
