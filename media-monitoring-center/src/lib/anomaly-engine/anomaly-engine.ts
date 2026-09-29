import type { MetricId, PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { MonitoringSettings } from "@/lib/config/settings";
import { METRICS } from "@/lib/metrics";
import { PLATFORMS } from "@/lib/platforms/registry";
import { hourLabel } from "@/lib/time/tz";
import type { Anomaly, AnomalyEvidence, AnomalyFamily, AnomalyType, EntityEvaluation, MetricComparison } from "@/lib/monitoring/types";
import { classifyDeviation, downgrade, maxSeverity, minSeverity, severityRank, upgrade } from "./severity";

/**
 * AnomalyEngine: evalúa gasto, resultados (conversiones, leads, ventas, WhatsApp, llamadas),
 * costo por resultado (CPA/CPL), CTR, CPC y CPM. No usa solo porcentajes: combina volumen,
 * variabilidad histórica, hora del día, frescura del dato, objetivo de campaña y peso en el gasto.
 */

const TYPE_FAMILY: Record<AnomalyType, AnomalyFamily> = {
  DATA_ISSUE: "data",
  DELIVERY_CRITICAL: "delivery",
  PLATFORM_INCIDENT: "delivery",
  DELIVERY_ISSUE: "delivery",
  UNDERSPEND: "delivery",
  OVERSPEND: "delivery",
  TRACKING_ISSUE: "tracking",
  PERFORMANCE_ISSUE: "performance",
  EFFICIENCY_ISSUE: "efficiency",
  COST_INCREASE: "efficiency",
  PACING_DEVIATION: "pacing",
};

export const ANOMALY_LABEL: Record<AnomalyType, string> = {
  DATA_ISSUE: "Data issue",
  DELIVERY_CRITICAL: "Delivery critical",
  PLATFORM_INCIDENT: "Platform incident",
  DELIVERY_ISSUE: "Delivery issue",
  UNDERSPEND: "Bajo delivery",
  OVERSPEND: "Sobreinversión",
  TRACKING_ISSUE: "Tracking issue",
  PERFORMANCE_ISSUE: "Performance issue",
  EFFICIENCY_ISSUE: "Efficiency issue",
  COST_INCREASE: "Incremento de costo",
  PACING_DEVIATION: "Desviación de pacing",
};

/** Tipos que se agrupan bajo un padre con tipo compatible (anti-spam jerárquico). */
const SPEND_DROP_TYPES: AnomalyType[] = ["DELIVERY_ISSUE", "UNDERSPEND"];
/** Resultados peores que el gasto: misma causa raíz vista como caída de resultados o como costo al alza. */
const RESULT_DROP_TYPES: AnomalyType[] = ["PERFORMANCE_ISSUE", "COST_INCREASE"];
/** Se juzgan con el gasto esperado a la hora de corte, que depende de la curva horaria. */
const CURVE_TYPES: AnomalyType[] = ["DELIVERY_ISSUE", "UNDERSPEND", "OVERSPEND", "PLATFORM_INCIDENT"];
/** Alertas de nivel de gasto que se revisan contra un cambio sostenido de los últimos días. */
const SUSTAINED_TYPES: AnomalyType[] = ["DELIVERY_CRITICAL", "DELIVERY_ISSUE", "UNDERSPEND", "OVERSPEND"];

export interface AnomalyContext {
  settings: MonitoringSettings;
  cutoffHour: number;
}

interface Signals {
  spend: MetricComparison | undefined;
  result: MetricComparison | undefined;
  cost: MetricComparison | undefined;
  clicks: MetricComparison | undefined;
}

const pct = (v: number | null) => (v === null ? "s/d" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

function minSpendFor(e: EntityEvaluation, s: MonitoringSettings) {
  return e.level === "platform" ? s.volume.minPlatformSpend : s.volume.minCampaignSpend;
}

function minResultsFor(e: EntityEvaluation, s: MonitoringSettings) {
  // Impresiones y clics son volúmenes grandes: el mínimo de resultados aplica a conversiones.
  if (e.kpi.result === "impressions" || e.kpi.result === "clicks") return 0;
  return e.level === "platform" ? s.volume.minPlatformResults : s.volume.minCampaignResults;
}

function evidenceOf(e: EntityEvaluation, metrics: MetricId[]): AnomalyEvidence[] {
  return metrics
    .map((m) => {
      const c = e.cumulative[m];
      if (!c) return null;
      const label = m === "cpr" ? e.kpi.costLabel : m === e.kpi.result ? e.kpi.resultLabel : METRICS[m].label;
      return { metric: m, label, current: c.current, expected: c.expected, prevWeek: c.prevWeek, deviation: c.deltaVsExpected };
    })
    .filter((x): x is AnomalyEvidence => x !== null);
}

function makeAnomaly(
  e: EntityEvaluation,
  type: AnomalyType,
  severity: Severity,
  metric: MetricId,
  cmp: MetricComparison | undefined,
  title: string,
  diagnosis: string,
  evidenceMetrics: MetricId[],
): Anomaly {
  const family = TYPE_FAMILY[type];
  return {
    key: e.key,
    level: e.level,
    platform: e.platform,
    accountId: e.accountId,
    accountName: e.accountName,
    campaignId: e.campaignId,
    campaignName: e.campaignName,
    fingerprint: `${e.key}#${family}`,
    type,
    family,
    severity,
    rawSeverity: severity,
    metric,
    current: cmp?.current ?? null,
    expected: cmp?.expected ?? null,
    deviation: cmp?.deltaVsExpected ?? null,
    title,
    diagnosis,
    adjustments: [],
    evidence: evidenceOf(e, evidenceMetrics),
    objective: e.objective,
    expectedSpendShare: e.expectedSpendShare,
    cutoffHour: e.cutoffHour,
    groupedUnder: null,
  };
}

export function isSignificantCount(cmp: MetricComparison | undefined, k = 2): boolean {
  if (!cmp || cmp.current === null || cmp.expected === null) return false;
  return Math.abs(cmp.current - cmp.expected) >= k * Math.sqrt(Math.max(cmp.expected, 1));
}

function entityName(e: EntityEvaluation): string {
  if (e.level === "campaign") return e.campaignName ?? e.campaignId ?? "Campaña";
  if (e.level === "account") return e.accountName ?? e.accountId ?? "Cuenta";
  return PLATFORMS[e.platform].name;
}

/** Aplica las reglas de patrón a una entidad con datos al día. */
function detectPerformance(e: EntityEvaluation, ctx: AnomalyContext): Anomaly | null {
  const { settings } = ctx;
  const t = settings.thresholds;
  // Resultados que llegan con retraso (conversiones offline): hoy solo se juzga el gasto.
  const lagging = Boolean(e.resultLagging);
  const sig: Signals = {
    spend: e.cumulative.spend,
    result: lagging ? undefined : e.cumulative[e.kpi.result],
    cost: lagging ? undefined : e.cumulative.cpr,
    clicks: e.cumulative.clicks,
  };
  const minSpend = minSpendFor(e, settings);
  const minResults = minResultsFor(e, settings);
  const spendExp = sig.spend?.expected ?? null;
  if (spendExp === null) return null; // histórico insuficiente: no se evalúa
  if (spendExp < minSpend && (sig.spend?.current ?? 0) < minSpend) return null; // volumen irrelevante

  const dS = sig.spend?.deltaVsExpected ?? null;
  const dR = sig.result?.deltaVsExpected ?? null;
  const dC = sig.cost?.deltaVsExpected ?? null;
  const dK = sig.clicks?.deltaVsExpected ?? null;
  const resultEvaluable = sig.result?.expected !== null && sig.result?.expected !== undefined && sig.result.expected >= minResults;
  // Significancia estadística para conteos (aprox. Poisson): una variación dentro de ±2·√esperado es ruido.
  const resultSignificant = isSignificantCount(sig.result);
  const name = entityName(e);
  const window = `00:00–${hourLabel(e.cutoffHour)}`;
  const spendEv: MetricId[] = lagging ? ["spend"] : ["spend", e.kpi.result, "cpr"];

  // CASO: dejó de gastar en la ventana reciente (paro súbito aunque el acumulado aún no lo refleje).
  // Con curva estimada la ventana reciente es el acumulado repartido: no dice cuándo dejó de gastar.
  const rs = e.curveEstimated ? undefined : e.recent?.spend;
  if (rs && rs.expected !== null && rs.expected >= minSpend * 0.25 && rs.current !== null) {
    const raw = rs.deltaVsExpected ?? 0;
    // Si el gasto ya venía en un nivel más bajo desde hace días, la caída se mide contra ese nivel.
    const level = e.sustained?.direction === "down" && e.sustained.ratio > 0.05 ? e.sustained.ratio : 1;
    const drop = level < 1 ? (1 + raw) / level - 1 : raw;
    if (rs.current === 0 || drop <= -settings.detection.stoppedSpendDrop) {
      return makeAnomaly(
        e,
        "DELIVERY_CRITICAL",
        "CRITICAL",
        "spend",
        rs,
        `${name} dejó de gastar`,
        `Gasto de ${hourLabel(e.recentFromHour)} a ${hourLabel(e.cutoffHour)} ${pct(raw)} vs el mismo horario de semanas anteriores${level < 1 ? ` (${pct(drop)} contra su nivel de los últimos ${e.sustained!.days} días)` : ""}. Los datos están al día: es un problema real de delivery (presupuesto, pago, aprobación o pausa), no de datos.`,
        spendEv,
      );
    }
  }

  // CASO 4: campaña activa con gasto = 0.
  if (sig.spend?.current === 0 && spendExp >= minSpend) {
    return makeAnomaly(
      e,
      "DELIVERY_CRITICAL",
      "CRITICAL",
      "spend",
      sig.spend,
      e.level === "campaign" ? "Campaña activa sin gasto" : `${name} sin gasto`,
      `Está activa y los datos están al día, pero no ha gastado nada en ${window} (se esperaban ${Math.round(spendExp).toLocaleString("es-MX")} MXN). Revisar aprobación de anuncios, método de pago, límites de gasto o segmentación.`,
      spendEv,
    );
  }

  // CASO 6: gasto normal con resultados = 0 → tracking.
  const spendCur = sig.spend?.current ?? 0;
  if (sig.result && sig.result.current === 0 && resultEvaluable && spendCur >= minSpend * 0.5 && (dS === null || dS > -t.attention)) {
    return makeAnomaly(
      e,
      "TRACKING_ISSUE",
      "CRITICAL",
      e.kpi.result,
      sig.result,
      `${e.kpi.resultLabel} en cero con gasto normal`,
      `El gasto va ${pct(dS)} vs esperado, pero ${e.kpi.resultLabel.toLowerCase()} = 0 en ${window} (esperado ≈ ${Math.round(sig.result.expected ?? 0).toLocaleString("es-MX")}). Probable problema de tracking: píxel/CAPI, carga de conversiones offline o cambio en el evento de conversión.`,
      spendEv,
    );
  }
  // Métrica de conversión que llega NULL cuando históricamente sí tenía dato.
  if (sig.result && sig.result.current === null && sig.result.sampleCount >= settings.history.minSamples && spendCur >= minSpend) {
    return makeAnomaly(
      e,
      "TRACKING_ISSUE",
      "ALERT",
      e.kpi.result,
      sig.result,
      `${e.kpi.resultLabel} sin dato (NULL)`,
      `La métrica llega vacía hoy, aunque en semanas anteriores sí se reportaba. No se interpreta como cero: revisar el campo de conversión en la fuente o la integración.`,
      spendEv,
    );
  }

  let type: AnomalyType | null = null;
  let severity: Severity = "NORMAL";
  let metric: MetricId = "spend";
  let cmp: MetricComparison | undefined = sig.spend;
  let title = "";
  let diagnosis = "";

  const spendDown = dS !== null && dS <= -t.attention;
  const spendUp = dS !== null && dS >= t.attention;
  const spendNormal = dS !== null && Math.abs(dS) < t.attention;
  const resultsDown = resultEvaluable && resultSignificant && dR !== null && dR <= -t.attention;

  if (spendDown && resultsDown) {
    // CASO 1: gasto ↓ y resultados ↓ → delivery.
    type = "DELIVERY_ISSUE";
    severity = classifyDeviation(Math.max(Math.abs(dS), Math.abs(dR!)), t);
    title = `Caída de gasto y ${e.kpi.resultLabel.toLowerCase()}`;
    diagnosis = `Gasto ${pct(dS)} y ${e.kpi.resultLabel.toLowerCase()} ${pct(dR)} vs el mismo día y franja (${window}) de semanas anteriores. Probable problema de delivery: presupuesto, pujas, aprobaciones o subasta.`;
  } else if (spendDown) {
    type = "UNDERSPEND";
    severity = resultEvaluable ? downgrade(classifyDeviation(Math.abs(dS), t)) : classifyDeviation(Math.abs(dS), t);
    title = "Bajo delivery";
    diagnosis = resultEvaluable
      ? `Gasto ${pct(dS)} vs esperado con ${e.kpi.resultLabel.toLowerCase()} estables (${pct(dR)}). Menor inversión sin afectar resultados todavía.`
      : `Gasto ${pct(dS)} vs esperado en ${window}.`;
  } else if (spendNormal && resultsDown) {
    // CASO 2: gasto normal y resultados ↓ → performance o tracking.
    const clicksNormal = dK !== null && Math.abs(dK) < t.attention;
    metric = e.kpi.result;
    cmp = sig.result;
    // Con curva estimada el esperado de gasto y de resultados comparte el mismo sesgo: se mide la caída relativa al gasto.
    const dRel = e.curveEstimated && dS !== null && dS > -1 ? (1 + dR!) / (1 + dS) - 1 : dR!;
    severity = classifyDeviation(Math.abs(dRel), t);
    if (clicksNormal && dRel < -t.critical) {
      type = "TRACKING_ISSUE";
      title = `Caída de ${e.kpi.resultLabel.toLowerCase()} con tráfico normal`;
      diagnosis = `Gasto (${pct(dS)}) y clics (${pct(dK)}) normales, pero ${e.kpi.resultLabel.toLowerCase()} ${pct(dR)}. El tráfico llega igual: posible problema de tracking o de atribución.`;
    } else {
      type = "PERFORMANCE_ISSUE";
      title = `Caída de ${e.kpi.resultLabel.toLowerCase()}`;
      diagnosis = `Gasto normal (${pct(dS)}) con ${e.kpi.resultLabel.toLowerCase()} ${pct(dR)} vs referencia. Revisar creativos, landing, oferta o calidad del tráfico (clics ${pct(dK)}).`;
    }
  } else if (spendUp) {
    // CASO 3: gasto ↑ con resultados que no acompañan → eficiencia; si acompañan → sobreinversión.
    if (dC !== null && dC >= t.attention) {
      type = "EFFICIENCY_ISSUE";
      // El costo por resultado no depende de la curva horaria; el gasto vs esperado sí.
      severity = classifyDeviation(e.curveEstimated ? dC : Math.max(dS, dC), t);
      metric = "cpr";
      cmp = sig.cost;
      title = `Gasto al alza con ${e.kpi.costLabel} +${(dC * 100).toFixed(0)}%`;
      diagnosis = `Gasto ${pct(dS)} vs esperado, ${e.kpi.resultLabel.toLowerCase()} ${pct(dR)} y ${e.kpi.costLabel} ${pct(dC)}. Se está invirtiendo más sin retorno proporcional.`;
    } else {
      type = "OVERSPEND";
      severity = classifyDeviation(dS, t);
      title = "Sobreinversión";
      diagnosis = `Gasto ${pct(dS)} vs el mismo día y franja de semanas anteriores${dR !== null ? `, con ${e.kpi.resultLabel.toLowerCase()} ${pct(dR)}` : ""}. Revisar presupuesto y pacing para no agotar el mensual antes de tiempo.`;
    }
  } else if (resultEvaluable && resultSignificant && dC !== null && dC >= t.attention) {
    type = "COST_INCREASE";
    severity = classifyDeviation(dC, t);
    metric = "cpr";
    cmp = sig.cost;
    title = `${e.kpi.costLabel} al alza`;
    diagnosis = `${e.kpi.costLabel} ${pct(dC)} vs referencia con gasto ${pct(dS)} y ${e.kpi.resultLabel.toLowerCase()} ${pct(dR)}.`;
  }

  if (!type || severity === "NORMAL") return null;
  return makeAnomaly(e, type, severity, metric, cmp, title, diagnosis, spendEv.concat(["clicks", "ctr", "cpc", "cpm"]));
}

/** Ajustes que evitan falsas alarmas: hora, variabilidad y volumen. */
function adjust(a: Anomaly, e: EntityEvaluation, ctx: AnomalyContext): Anomaly {
  const { settings } = ctx;
  if (a.type === "DATA_ISSUE") return a;
  let s = a.severity;
  const notes: string[] = [];
  const earlyShare = e.dayShare !== null && e.dayShare < settings.detection.earlyDayShare;
  if (e.cutoffHour < settings.detection.earlyHour || (earlyShare && a.type !== "DELIVERY_CRITICAL")) {
    const d = downgrade(s);
    if (d !== s)
      notes.push(
        e.cutoffHour < settings.detection.earlyHour
          ? `Pocas horas transcurridas (corte ${hourLabel(e.cutoffHour)}): severidad reducida un nivel.`
          : `A esta hora suele haber ocurrido solo el ${Math.round((e.dayShare ?? 0) * 100)}% del volumen del día: severidad reducida un nivel.`,
      );
    s = d;
  }
  const hardEvidence = a.type === "DELIVERY_CRITICAL" || (a.type === "TRACKING_ISSUE" && a.current === 0);
  if (!hardEvidence) {
    const cmp = e.cumulative[a.metric];
    const z = cmp?.zScore ?? null;
    if (z !== null && Math.abs(z) < settings.detection.zScoreFloor && severityRank(s) > severityRank("ATTENTION")) {
      s = downgrade(s);
      notes.push(`La desviación está dentro de la variabilidad histórica (z = ${z.toFixed(1)}): severidad reducida un nivel.`);
    }
    const minRes = minResultsFor(e, settings);
    const resCmp = e.cumulative[e.kpi.result];
    if (a.metric !== "spend" && resCmp?.expected !== null && resCmp?.expected !== undefined && resCmp.expected < minRes * 2 && severityRank(s) > severityRank("ATTENTION")) {
      s = "ATTENTION";
      notes.push("Volumen de resultados bajo: se limita a ATENCIÓN para evitar ruido estadístico.");
    }
  }
  // Cambio sostenido: si el gasto ya lleva días en otro nivel, la severidad mide lo que cambió hoy contra ese nivel.
  const lvl = e.sustained;
  const d = e.cumulative.spend?.deltaVsExpected ?? null;
  if (lvl && SUSTAINED_TYPES.includes(a.type) && a.metric === "spend" && d !== null && lvl.direction === (d < 0 ? "down" : "up")) {
    const t = settings.thresholds;
    const today = 1 + d;
    const rel = lvl.ratio > 0.05 ? today / lvl.ratio - 1 : today < 0.05 ? 0 : null;
    const since = `Viene así desde hace ${lvl.days} días (gasto ${pct(lvl.ratio - 1)} vs semanas anteriores)`;
    if (rel !== null && Math.abs(rel) < t.attention) {
      s = minSeverity(s, "ATTENTION");
      notes.push(`${since} y hoy sigue en ese nivel: parece un cambio de presupuesto o de estrategia, no una falla de hoy. Si no fue planeado, revisar.`);
    } else if (rel !== null) {
      s = minSeverity(s, maxSeverity(classifyDeviation(Math.abs(rel), t), "ATTENTION"));
      notes.push(`${since}; hoy va ${pct(rel)} contra ese nivel.`);
    }
  }
  if (e.resultLagging && a.family === "delivery") {
    notes.push(`${e.kpi.resultLabel} de ${PLATFORMS[e.platform].shortName} llegan con retraso (conversiones offline): en el día solo se evalúa el gasto.`);
  }
  return { ...a, severity: s, adjustments: notes };
}

function dataIssue(e: EntityEvaluation): Anomaly {
  const state = e.dataState;
  const label = state === "ERROR" ? "ERROR de sincronización" : state === "NO_DATA" ? "Sin datos" : "DATA DELAYED";
  return makeAnomaly(
    e,
    "DATA_ISSUE",
    e.dataSeverity,
    "spend",
    undefined,
    `${label}: ${entityName(e)}`,
    `${e.dataStateReason ?? "La fuente no está actualizada."} No se evalúa rendimiento hasta que lleguen datos: un atraso no se interpreta como caída de gasto ni de resultados.`,
    [],
  );
}

export function detectAnomalies(evaluations: EntityEvaluation[], ctx: AnomalyContext): Anomaly[] {
  const out: Anomaly[] = [];
  const byKey = new Map(evaluations.map((e) => [e.key, e]));
  const parentKeys = (e: EntityEvaluation): string[] => {
    const keys: string[] = [];
    if (e.level === "campaign" && e.accountId) keys.push(`account:${e.platform}:${e.accountId}`);
    if (e.level !== "platform") keys.push(`platform:${e.platform}`);
    return keys;
  };

  for (const e of evaluations) {
    const dataBad = e.dataState === "DELAYED" || e.dataState === "ERROR" || e.dataState === "NO_DATA";
    if (dataBad) {
      const parentBad = parentKeys(e).some((k) => {
        const p = byKey.get(k);
        return p && (p.dataState === "DELAYED" || p.dataState === "ERROR" || p.dataState === "NO_DATA");
      });
      if (!parentBad) out.push(dataIssue(e));
      continue;
    }
    if (e.level === "campaign" && e.status !== "ACTIVE") continue;
    const a = detectPerformance(e, ctx);
    if (a) {
      const adjusted = adjust(a, e, ctx);
      if (adjusted.severity !== "NORMAL") out.push(adjusted);
    }
  }

  // CASO 5: varias campañas de una plataforma caen al mismo tiempo → incidente de plataforma.
  const { platformIncidentMinCampaigns, platformIncidentMinShare } = ctx.settings.detection;
  for (const p of PLATFORM_IDS) {
    const drops = out.filter((a) => a.platform === p && a.level === "campaign" && SPEND_DROP_TYPES.includes(a.type));
    const share = drops.reduce((acc, a) => acc + (a.expectedSpendShare ?? 0), 0);
    if (drops.length < platformIncidentMinCampaigns || share < platformIncidentMinShare) continue;
    const platformEval = byKey.get(`platform:${p}`);
    if (!platformEval) continue;
    const existing = out.find((a) => a.level === "platform" && a.platform === p && a.family === "delivery");
    const worstChild = maxSeverity(...drops.map((d) => d.severity));
    const detail = `${drops.length} campañas (${Math.round(share * 100)}% del gasto esperado) con caída simultánea de delivery.`;
    if (existing && existing.type !== "DELIVERY_CRITICAL") {
      existing.type = "PLATFORM_INCIDENT";
      existing.severity = maxSeverity(upgrade(existing.severity), "ALERT", worstChild);
      existing.title = `${drops.length} campañas con caída simultánea de delivery`;
      existing.diagnosis = `${detail} ${existing.diagnosis}`;
      existing.adjustments = [...existing.adjustments, "Severidad elevada un nivel por caída simultánea en varias campañas."];
    } else if (!existing) {
      const spend = platformEval.cumulative.spend;
      out.push({
        ...makeAnomaly(
          platformEval,
          "PLATFORM_INCIDENT",
          maxSeverity("ALERT", worstChild),
          "spend",
          spend,
          `${drops.length} campañas con caída simultánea de delivery`,
          `${detail} El total de la plataforma aún puede verse compensado por otras campañas.`,
          ["spend", platformEval.kpi.result, "cpr"],
        ),
      });
    }
  }

  // Curva horaria estimada: el esperado a la hora de corte es aproximado. Las alertas que dependen de
  // él bajan un nivel (máximo ALERTA); gasto en cero sigue siendo evidencia firme.
  for (const a of out) {
    const e = byKey.get(a.key);
    if (!e?.curveEstimated || !CURVE_TYPES.includes(a.type) || a.current === 0) continue;
    const capped = maxSeverity(minSeverity(downgrade(a.severity), "ALERT"), "ATTENTION");
    if (capped === a.severity) continue;
    a.severity = capped;
    a.adjustments = [
      ...a.adjustments,
      "La hoja solo trae el acumulado del día: el esperado a esta hora sale de una curva típica, no de datos por hora. Severidad reducida un nivel hasta tener la consulta por hora de Dataslayer.",
    ];
  }

  // Anti-spam jerárquico: una anomalía hija con el mismo tipo que su padre se agrupa bajo él.
  const compatible = (child: Anomaly, parent: Anomaly) => {
    if (SPEND_DROP_TYPES.includes(child.type)) return [...SPEND_DROP_TYPES, "PLATFORM_INCIDENT"].includes(parent.type);
    if (RESULT_DROP_TYPES.includes(child.type)) return RESULT_DROP_TYPES.includes(parent.type);
    return child.type === parent.type;
  };
  for (const a of out) {
    if (a.level === "platform") continue;
    const e = byKey.get(a.key);
    if (!e) continue;
    // Se busca el ancestro más alto compatible (plataforma antes que cuenta).
    for (const k of [...parentKeys(e)].reverse()) {
      const parent = out.find((x) => x.key === k && compatible(a, x));
      if (parent) {
        a.groupedUnder = parent.fingerprint;
        break;
      }
    }
  }

  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/**
 * Severidad con la que una anomalía afecta el color de su plataforma.
 * Una campaña pequeña con problema no pinta de rojo toda la plataforma.
 */
export function platformImpactSeverity(a: Anomaly, settings: MonitoringSettings): Severity {
  if (a.groupedUnder) return "NORMAL";
  if (a.level !== "campaign") return a.severity;
  const material = (a.expectedSpendShare ?? 0) >= settings.detection.materialShare;
  return minSeverity(a.severity, material ? "ALERT" : "ATTENTION");
}

export type { PlatformId };
