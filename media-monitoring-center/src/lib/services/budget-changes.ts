import type { BudgetOverview } from "@/lib/services/platform-budgets";
import type { PlatformId } from "@/lib/types";

/**
 * Cambios de presupuesto diario entre dos fotos (hoy contra el último día guardado). Un cambio es
 * relevante si supera el umbral de atención del equipo (Settings) o si el presupuesto apareció o
 * dejó de estar activo. Montos en MXN, por unidad de presupuesto (campaña o compartido).
 */

export interface BudgetSnapshot {
  date: string;
  at: string;
  units: Record<string, { platform: PlatformId; name: string; strategy: string; daily: number }>;
}

export interface BudgetChange {
  key: string;
  platform: PlatformId;
  name: string;
  strategy: string;
  before: number | null;
  after: number | null;
  delta: number;
  pct: number | null;
  kind: "up" | "down" | "new" | "gone";
}

export interface BudgetChanges {
  since: string;
  net: number;
  counts: Record<BudgetChange["kind"], number>;
  changes: BudgetChange[];
}

export function snapshotFrom(overview: BudgetOverview, date: string, at: string): BudgetSnapshot {
  const units: BudgetSnapshot["units"] = {};
  for (const p of overview.platforms)
    for (const u of p.units) units[`${p.platform}:${u.key}`] = { platform: p.platform, name: u.name, strategy: u.strategy, daily: Math.round(u.budget * 100) / 100 };
  return { date, at, units };
}

export function detectBudgetChanges(prev: BudgetSnapshot, current: BudgetSnapshot, threshold: number): BudgetChanges {
  const changes: BudgetChange[] = [];
  for (const [key, now] of Object.entries(current.units)) {
    const before = prev.units[key];
    if (!before) {
      changes.push({ key, platform: now.platform, name: now.name, strategy: now.strategy, before: null, after: now.daily, delta: now.daily, pct: null, kind: "new" });
      continue;
    }
    const delta = now.daily - before.daily;
    const pct = before.daily > 0 ? delta / before.daily : null;
    if (pct !== null && Math.abs(pct) >= threshold)
      changes.push({ key, platform: now.platform, name: now.name, strategy: now.strategy, before: before.daily, after: now.daily, delta, pct, kind: delta > 0 ? "up" : "down" });
  }
  for (const [key, was] of Object.entries(prev.units))
    if (!current.units[key]) changes.push({ key, platform: was.platform, name: was.name, strategy: was.strategy, before: was.daily, after: null, delta: -was.daily, pct: null, kind: "gone" });
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const counts = { up: 0, down: 0, new: 0, gone: 0 };
  for (const c of changes) counts[c.kind]++;
  return { since: prev.date, net: changes.reduce((s, c) => s + c.delta, 0), counts, changes };
}

/** Foto "de ayer" para el modo demo: varía unas cuantas unidades de la de hoy. */
export function demoPreviousSnapshot(current: BudgetSnapshot, date: string): BudgetSnapshot {
  const entries = Object.entries(current.units);
  const units: BudgetSnapshot["units"] = {};
  entries.forEach(([key, u], i) => {
    if (i === 2) return; // hoy es nueva
    units[key] = { ...u, daily: i === 0 ? Math.round(u.daily / 1.3) : i === 1 ? Math.round(u.daily * 1.4) : u.daily };
  });
  units["demo:apagada"] = { platform: entries[0]?.[1].platform ?? "meta", name: "Campaña de ejemplo que ya no tiene presupuesto activo", strategy: "Branding", daily: 15000 };
  return { date, at: current.at, units };
}
