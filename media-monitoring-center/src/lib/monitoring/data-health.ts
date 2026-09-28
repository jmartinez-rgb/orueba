import type { DataQualityStats, DataState, FreshnessRecord, PlatformId, Severity } from "@/lib/types";
import type { MonitoringSettings } from "@/lib/config/settings";
import { businessDate, zonedParts } from "@/lib/time/tz";

/**
 * DATA HEALTH: antes de analizar rendimiento se valida la calidad del dato.
 * Diferencia explícitamente 0 (valor real), NULL (sin dato), DATA DELAYED y ERROR para
 * que una fuente atrasada nunca se lea como caída de performance.
 */

export interface FreshnessEvaluation {
  state: Exclude<DataState, "PARTIAL">;
  lagMinutes: number | null;
  /** Hasta qué hora local (exclusiva) cubren los datos de hoy. */
  coveredUntilHour: number;
  reason: string | null;
  severity: Severity;
}

export function evaluateFreshness(
  rec: FreshnessRecord | undefined,
  asOf: Date,
  settings: MonitoringSettings,
): FreshnessEvaluation {
  const tz = settings.timezone;
  const { delayedAfterMinutes, criticalAfterMinutes, cutoffToleranceMinutes } = settings.freshness;
  if (!rec || !rec.lastDataAt) {
    return { state: "NO_DATA", lagMinutes: null, coveredUntilHour: 0, reason: "No se ha recibido ningún dato de esta fuente.", severity: "ALERT" };
  }
  const last = new Date(rec.lastDataAt);
  const lag = Math.max(0, Math.round((asOf.getTime() - last.getTime()) / 60000));
  const today = businessDate(asOf, tz);
  let covered = 0;
  if (businessDate(last, tz) === today) {
    const p = zonedParts(last, tz);
    covered = 60 - p.minute <= cutoffToleranceMinutes ? p.hour + 1 : p.hour;
  } else if (last.getTime() > asOf.getTime()) {
    covered = 24;
  }
  if (rec.lastSyncStatus === "FAILED" && lag >= 60) {
    return {
      state: "ERROR",
      lagMinutes: lag,
      coveredUntilHour: covered,
      reason: rec.lastError ?? "La última sincronización falló.",
      severity: lag >= criticalAfterMinutes ? "CRITICAL" : "ALERT",
    };
  }
  if (lag > delayedAfterMinutes) {
    return {
      state: "DELAYED",
      lagMinutes: lag,
      coveredUntilHour: covered,
      reason: rec.lastError ?? `Sin datos nuevos desde hace ${Math.floor(lag / 60)} h ${lag % 60} min.`,
      severity: lag >= criticalAfterMinutes ? "ALERT" : "ATTENTION",
    };
  }
  return { state: "OK", lagMinutes: lag, coveredUntilHour: covered, reason: null, severity: "NORMAL" };
}

export type CheckStatus = "OK" | "WARN" | "FAIL";

export interface DataCheck {
  id: "freshness" | "sync" | "missing" | "duplicates" | "nulls" | "incomplete" | "absence" | "accounts";
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface PlatformDataHealth {
  platform: PlatformId;
  state: DataState;
  lastDataAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: FreshnessRecord["lastSyncStatus"];
  lagMinutes: number | null;
  effectiveCutoffHour: number;
  score: number;
  checks: DataCheck[];
  delayedAccounts: Array<{ accountId: string; accountName: string; state: DataState; lagMinutes: number | null; reason: string | null }>;
}

export function buildPlatformDataHealth(params: {
  platform: PlatformId;
  record: FreshnessRecord | undefined;
  freshness: FreshnessEvaluation;
  quality: DataQualityStats | undefined;
  missingHours: number[];
  hasRowsToday: boolean;
  effectiveCutoffHour: number;
  delayedAccounts: PlatformDataHealth["delayedAccounts"];
}): PlatformDataHealth {
  const { platform, record, freshness, quality, missingHours, hasRowsToday, effectiveCutoffHour, delayedAccounts } = params;
  const checks: DataCheck[] = [];
  const lag = freshness.lagMinutes;
  checks.push({
    id: "freshness",
    label: "Última actualización",
    status: freshness.state === "OK" ? "OK" : freshness.severity === "ATTENTION" ? "WARN" : "FAIL",
    detail: lag === null ? "Sin datos recibidos" : `Último dato hace ${lag} min${freshness.reason ? ` · ${freshness.reason}` : ""}`,
  });
  checks.push({
    id: "sync",
    label: "Sincronización",
    status: record?.lastSyncStatus === "FAILED" ? "FAIL" : record?.lastSyncStatus === "SUCCESS" ? "OK" : "WARN",
    detail:
      record?.lastSyncStatus === "FAILED"
        ? (record.lastError ?? "La última ejecución falló")
        : record?.lastSyncStatus === "SUCCESS"
          ? "Última ejecución correcta"
          : "Estado de sincronización desconocido",
  });
  checks.push({
    id: "absence",
    label: "Datos del día",
    status: hasRowsToday || effectiveCutoffHour === 0 ? "OK" : "FAIL",
    detail: hasRowsToday ? "Hay datos del día en curso" : effectiveCutoffHour === 0 ? "El día aún no tiene horas completas" : "No hay ninguna fila del día",
  });
  checks.push({
    id: "missing",
    label: "Horas faltantes",
    status: missingHours.length === 0 ? "OK" : "WARN",
    detail: missingHours.length === 0 ? "Todas las horas de la ventana tienen datos" : `Sin filas en ${missingHours.length} hora(s): ${missingHours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}`,
  });
  const dup = quality?.duplicateRows ?? 0;
  checks.push({
    id: "duplicates",
    label: "Duplicados",
    status: dup > 0 ? "WARN" : "OK",
    detail: dup > 0 ? `${dup} fila(s) duplicadas en la carga (se deduplican al consultar)` : "Sin duplicados",
  });
  const nulls = quality?.nullSpendRows ?? 0;
  checks.push({
    id: "nulls",
    label: "Campos nulos",
    status: nulls > 0 ? "WARN" : "OK",
    detail: nulls > 0 ? `${nulls} fila(s) con gasto NULL (no se cuentan como cero)` : "Sin nulos en campos obligatorios",
  });
  const expectedRows = quality?.expectedLastHourRows ?? 0;
  const loaded = quality?.lastHourRows ?? 0;
  checks.push({
    id: "incomplete",
    label: "Carga completa",
    status: expectedRows === 0 || loaded >= expectedRows ? "OK" : "WARN",
    detail: expectedRows === 0 ? "Sin campañas activas esperadas" : `${loaded} de ${expectedRows} campañas activas cargadas en la última hora`,
  });
  checks.push({
    id: "accounts",
    label: "Retraso por cuenta",
    status: delayedAccounts.length === 0 ? "OK" : "WARN",
    detail:
      delayedAccounts.length === 0
        ? "Todas las cuentas al día"
        : delayedAccounts.map((a) => `${a.accountName}: ${a.state === "ERROR" ? "ERROR" : "DATA DELAYED"}`).join(" · "),
  });

  const score = Math.max(0, 100 - checks.reduce((a, c) => a + (c.status === "FAIL" ? 40 : c.status === "WARN" ? 12 : 0), 0));
  const state: DataState =
    freshness.state !== "OK" ? freshness.state : !hasRowsToday && effectiveCutoffHour > 0 ? "NO_DATA" : delayedAccounts.length > 0 ? "PARTIAL" : "OK";

  return {
    platform,
    state,
    lastDataAt: record?.lastDataAt ?? null,
    lastSyncAt: record?.lastSyncAt ?? null,
    lastSyncStatus: record?.lastSyncStatus ?? "UNKNOWN",
    lagMinutes: lag,
    effectiveCutoffHour,
    score,
    checks,
    delayedAccounts,
  };
}
