import type { ExecutionControlRow, PlatformId } from "@/lib/types";
import type { PlatformDataHealth } from "./data-health";

/**
 * CONFIANZA DE LOS DATOS (0–100 %). Baja cuando hay cualquier problema que pueda hacer que el
 * monitoreo se equivoque: datos atrasados o con error, cuentas excluidas, horas faltantes,
 * duplicados o nulos, pasos de Dataslayer/Apps Script pendientes, tipo de cambio faltante o
 * histórico incompleto. Cada punto que se descuenta queda explicado.
 */

export type ConfidenceLevel = "ALTA" | "MEDIA" | "BAJA";

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  reasons: Array<{ text: string; impact: number }>;
}

export interface ExecutionSummary {
  status: "LISTO" | "PARCIAL" | "PENDIENTE" | "ERROR" | "SIN_CONTROL";
  label: string;
  pending: string[];
  errors: string[];
  rows: Array<ExecutionControlRow & { stale: boolean }>;
}

export function levelOf(score: number): ConfidenceLevel {
  return score >= 85 ? "ALTA" : score >= 60 ? "MEDIA" : "BAJA";
}

/** Un paso está "vencido" si no ha corrido en 1.5 veces su frecuencia (+10 min de margen). */
export function isStale(row: ExecutionControlRow, asOf: Date): boolean {
  if (!row.lastRunAt) return true;
  const every = row.expectedEveryMinutes ?? 120;
  return asOf.getTime() - new Date(row.lastRunAt).getTime() > (every * 1.5 + 10) * 60000;
}

export function summarizeExecution(rows: ExecutionControlRow[], asOf: Date): ExecutionSummary {
  if (!rows.length) return { status: "SIN_CONTROL", label: "Sin hoja de control", pending: [], errors: [], rows: [] };
  const withStale = rows.map((r) => ({ ...r, stale: r.status !== "ERROR" && isStale(r, asOf) }));
  const errors = withStale.filter((r) => r.status === "ERROR").map((r) => r.step);
  const pending = withStale.filter((r) => r.status === "PENDIENTE" || r.stale).map((r) => r.step);
  const partial = withStale.some((r) => r.status === "PARCIAL" || r.status === "EJECUTANDO");
  if (errors.length) return { status: "ERROR", label: "Con errores: revisar", pending, errors, rows: withStale };
  if (pending.length) return { status: "PENDIENTE", label: "Debe ejecutarse", pending, errors, rows: withStale };
  if (partial) return { status: "PARCIAL", label: "Listo con avisos", pending, errors, rows: withStale };
  return { status: "LISTO", label: "Listo: todo se ejecutó", pending, errors, rows: withStale };
}

export function platformConfidence(input: {
  platform: PlatformId;
  health: PlatformDataHealth;
  delayedAfterMinutes: number;
  /** Participación (0–1) del gasto esperado que quedó fuera por cuentas atrasadas. */
  excludedShare: number;
  historySamples: number | null;
  historyWeeks: number;
  execution: Array<ExecutionControlRow & { stale: boolean }>;
  fxIssues: Array<{ kind: "fallback" | "missing"; accountName: string; month: string }>;
}): ConfidenceResult {
  const { health } = input;
  const reasons: ConfidenceResult["reasons"] = [];
  const minus = (impact: number, text: string) => {
    if (impact > 0) reasons.push({ text, impact: Math.round(impact) });
  };
  // Un problema grave de datos pone un techo; los demás problemas descuentan puntos debajo de ese techo.
  let cap = 100;
  let capReason: ConfidenceResult["reasons"][number] | null = null;
  if (health.state === "NO_DATA") {
    cap = 0;
    capReason = { text: "No hay datos del día.", impact: 100 };
  } else if (health.state === "ERROR") {
    cap = 20;
    capReason = { text: "La sincronización falló: los datos no son confiables hasta que se recupere.", impact: 80 };
  } else if (health.state === "DELAYED") {
    cap = 40;
    capReason = { text: `Datos atrasados${health.lagMinutes !== null ? ` (último dato hace ${Math.floor(health.lagMinutes / 60)} h ${health.lagMinutes % 60} min)` : ""}.`, impact: 60 };
  }
  if (health.state === "PARTIAL" || health.delayedAccounts.length) {
    minus(Math.max(10, 40 * input.excludedShare), `${health.delayedAccounts.length} cuenta(s) atrasada(s) excluida(s) de la comparación: ${health.delayedAccounts.map((a) => a.accountName).join(", ")}.`);
  }
  if (health.state === "OK" && health.lagMinutes !== null && health.lagMinutes > input.delayedAfterMinutes * 0.5) {
    minus(10, `El último dato llegó hace ${health.lagMinutes} min.`);
  }
  const missing = health.checks.find((c) => c.id === "missing");
  if (missing && missing.status !== "OK") {
    const n = (missing.detail.match(/\d{2}:00/g) ?? []).length;
    minus(Math.min(20, 4 * Math.max(1, n)), `Faltan filas en ${n} hora(s) del día.`);
  }
  const dup = health.checks.find((c) => c.id === "duplicates");
  if (dup && dup.status !== "OK") minus(Math.min(15, 3 * Number(dup.detail.match(/^\d+/)?.[0] ?? 1)), "Hay filas duplicadas en la carga.");
  const nulls = health.checks.find((c) => c.id === "nulls");
  if (nulls && nulls.status !== "OK") minus(Math.min(15, 3 * Number(nulls.detail.match(/^\d+/)?.[0] ?? 1)), "Hay filas con gasto NULL.");
  const incomplete = health.checks.find((c) => c.id === "incomplete");
  if (incomplete && incomplete.status !== "OK") minus(8, incomplete.detail + ".");

  for (const r of input.execution) {
    if (r.status === "ERROR") minus(30, `${r.step}: error${r.message ? ` (${r.message})` : ""}.`);
    else if (r.status === "PENDIENTE") minus(20, `${r.step}: pendiente de ejecutar.`);
    else if (r.stale) minus(15, `${r.step}: no ha corrido en el horario esperado.`);
    else if (r.status === "PARCIAL") minus(10, `${r.step}: carga parcial${r.message ? ` (${r.message})` : ""}.`);
    else if (r.status === "EJECUTANDO") minus(5, `${r.step}: en ejecución.`);
  }
  const missingFx = input.fxIssues.filter((i) => i.kind === "missing");
  const fallbackFx = input.fxIssues.filter((i) => i.kind === "fallback");
  if (missingFx.length) minus(25, `Sin tipo de cambio para ${[...new Set(missingFx.map((i) => i.month))].join(", ")}: el gasto en USD no se puede convertir.`);
  if (fallbackFx.length) minus(Math.min(10, 5 * fallbackFx.length), `Tipo de cambio de ${[...new Set(fallbackFx.map((i) => i.month))].join(", ")} no capturado: se usó el del mes anterior.`);
  if (input.historySamples !== null && input.historySamples < input.historyWeeks) {
    minus(Math.min(15, 5 * (input.historyWeeks - input.historySamples)), `Histórico incompleto: ${input.historySamples} de ${input.historyWeeks} semanas con dato.`);
  }
  const deducted = reasons.reduce((a, r) => a + r.impact, 0);
  const score = Math.max(0, cap - deducted);
  const all = capReason ? [capReason, ...reasons] : reasons;
  return { score: Math.round(score), level: levelOf(score), reasons: all.sort((a, b) => b.impact - a.impact) };
}

/** Confianza general: promedio ponderado por el gasto esperado de cada plataforma. */
export function overallConfidence(items: Array<{ result: ConfidenceResult; weight: number; name: string }>): ConfidenceResult {
  const total = items.reduce((a, i) => a + Math.max(0, i.weight), 0);
  const score = total > 0 ? items.reduce((a, i) => a + i.result.score * Math.max(0, i.weight), 0) / total : items.reduce((a, i) => a + i.result.score, 0) / Math.max(1, items.length);
  const reasons = items
    .filter((i) => i.result.score < 100)
    .sort((a, b) => a.result.score - b.result.score)
    .map((i) => ({ text: `${i.name}: ${i.result.score}% (${i.result.reasons[0]?.text ?? "revisar"})`, impact: 100 - i.result.score }));
  return { score: Math.round(score), level: levelOf(score), reasons };
}
