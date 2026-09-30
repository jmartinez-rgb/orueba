import type { MonitoringSettings } from "@/lib/config/settings";
import { PLATFORMS } from "@/lib/platforms/registry";
import { isIntentionalStop } from "@/lib/platforms/campaign-status";
import type { BreakdownItem, BreakdownKind, BreakdownVerdict, EntityEvaluation, MetricComparison, SpendBreakdown } from "@/lib/monitoring/types";

const KINDS: BreakdownKind[] = ["paused", "stopped", "down", "up", "new", "steady"];
const TOP = 8;

const pct = (v: number | null) => (v === null ? "s/d" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const money = (v: number) => `${Math.round(v).toLocaleString("es-MX")} MXN`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Desglose por campaña del gasto de una cuenta o plataforma: qué se apagó (pausado en la
 * plataforma o sin gasto), qué bajó o subió y qué es nuevo. El veredicto dice si la caída se
 * explica por una acción del equipo (pausas, rotación de campañas) o si es un apagado masivo.
 */
export function spendBreakdown(
  scope: EntityEvaluation,
  evaluations: EntityEvaluation[],
  settings: MonitoringSettings,
  window: "day" | "recent" = "day",
): SpendBreakdown | null {
  if (scope.level === "campaign") return null;
  const pick = (e: EntityEvaluation): MetricComparison | undefined => (window === "recent" ? e.recent?.spend : e.cumulative.spend);
  const t = settings.thresholds;
  const groups = Object.fromEntries(KINDS.map((k) => [k, { count: 0, current: 0, expected: 0 }])) as SpendBreakdown["groups"];
  const items: BreakdownItem[] = [];
  for (const c of evaluations) {
    if (c.level !== "campaign" || c.platform !== scope.platform) continue;
    if (scope.level === "account" && c.accountId !== scope.accountId) continue;
    // Una cuenta con datos atrasados no se puede leer: no entra al desglose.
    if (c.dataState === "DELAYED" || c.dataState === "ERROR" || c.dataState === "NO_DATA") continue;
    const cmp = pick(c);
    const expected = Math.max(0, cmp?.expected ?? 0);
    const current = Math.max(0, cmp?.current ?? 0);
    if (expected <= 0 && current <= 0) continue;
    const kind: BreakdownKind =
      expected > 0 && isIntentionalStop(c)
        ? "paused"
        : expected > 0 && current === 0
          ? "stopped"
          : expected <= 0
            ? "new"
            : current < expected * (1 - t.attention)
              ? "down"
              : current > expected * (1 + t.attention)
                ? "up"
                : "steady";
    const g = groups[kind];
    g.count += 1;
    g.current += current;
    g.expected += expected;
    items.push({ campaignId: c.campaignId ?? c.key, campaignName: c.campaignName ?? c.campaignId ?? c.key, accountName: c.accountName, kind, current, expected, statusText: c.statusSource === "platform" ? (c.statusText ?? null) : null });
  }
  if (!items.length) return null;
  const current = items.reduce((a, i) => a + i.current, 0);
  const expected = items.reduce((a, i) => a + i.expected, 0);
  const stoppedCount = groups.paused.count + groups.stopped.count;
  const stoppedExpected = groups.paused.expected + groups.stopped.expected;
  const stoppedShare = expected > 0 ? stoppedExpected / expected : 0;
  const rest = { count: groups.down.count + groups.up.count + groups.steady.count, current: groups.down.current + groups.up.current + groups.steady.current, expected: groups.down.expected + groups.up.expected + groups.steady.expected };
  const restDeviation = rest.expected > 0 ? rest.current / rest.expected - 1 : null;
  // Las que siguen activas no están cayendo (si suben, también cuenta como "el resto va bien").
  const restNormal = restDeviation === null || restDeviation > -t.attention;
  const falling = current < expected;

  let verdict: BreakdownVerdict;
  // Apagado masivo: casi todo lo esperado se detuvo Y la cuenta o plataforma quedó casi en cero
  // (si campañas nuevas reemplazan el gasto, es una rotación, no un apagado).
  const massShare = settings.detection.massStopShare;
  if (falling && stoppedShare >= massShare && current <= expected * (1 - massShare)) verdict = "mass_stop";
  else if (falling && stoppedCount > 0 && groups.new.current >= 0.5 * stoppedExpected) verdict = "rotation";
  else if (falling && stoppedCount > 0 && restNormal) verdict = groups.stopped.count === 0 ? "planned_stop" : "partial_stop";
  else if (falling && stoppedCount > 0) verdict = "mixed";
  else if (!falling && groups.new.current > 0 && groups.new.current >= 0.5 * (current - expected)) verdict = "launch";
  else verdict = "running_change";

  const where = PLATFORMS[scope.platform].shortName;
  const restText = rest.count ? ` Las ${plural(rest.count, "campaña que sigue activa va", "campañas que siguen activas van")} ${pct(restDeviation)} vs lo esperado.` : "";
  const pausedText = groups.paused.count ? ` (${plural(groups.paused.count, "pausada", "pausadas")} en ${where})` : "";
  const summary: Record<BreakdownVerdict, string> = {
    mass_stop: `Se detuvo de golpe el ${Math.round(stoppedShare * 100)}% del gasto esperado: ${stoppedCount} de ${items.length} campañas sin gasto${pausedText}.`,
    planned_stop: `${plural(groups.paused.count, "campaña pausada", "campañas pausadas")} en ${where} explican la caída (se esperaban ${money(stoppedExpected)} de ellas).${restText}`,
    partial_stop: `${plural(stoppedCount, "campaña dejó", "campañas dejaron")} de gastar (${Math.round(stoppedShare * 100)}% del gasto esperado)${pausedText}.${restText}`,
    rotation: `${plural(stoppedCount, "campaña se apagó", "campañas se apagaron")} y ${plural(groups.new.count, "nueva empezó", "nuevas empezaron")} a gastar (${money(groups.new.current)}): parece una rotación de campañas.`,
    mixed: `${plural(stoppedCount, "campaña se apagó", "campañas se apagaron")} (${money(stoppedExpected)} del esperado) y las que siguen activas también bajan (${pct(restDeviation)}).`,
    running_change: falling
      ? `Ninguna campaña se apagó: la caída viene de las activas (${plural(groups.down.count, "baja", "bajan")}; en conjunto ${pct(restDeviation)}).`
      : `Las campañas activas gastan más de lo usual (${plural(groups.up.count, "sube", "suben")}; en conjunto ${pct(restDeviation)}).`,
    launch: `${plural(groups.new.count, "campaña nueva gasta", "campañas nuevas gastan")} ${money(groups.new.current)} y explican la subida.`,
  };
  const top = [...items].sort((a, b) => Math.abs(b.current - b.expected) - Math.abs(a.current - a.expected)).slice(0, TOP);
  return { window, campaigns: items.length, current, expected, groups, stoppedShare, restDeviation, verdict, summary: summary[verdict], top };
}
