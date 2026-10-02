import type { MetricId, PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { MonitoringSettings } from "@/lib/config/settings";
import { METRICS } from "@/lib/metrics";
import { PLATFORMS } from "@/lib/platforms/registry";
import { spendBreakdown } from "./breakdown";
import { hourLabel } from "@/lib/time/tz";
import type { Anomaly, AnomalyEvidence, AnomalyFamily, AnomalyType, EntityEvaluation, ExplainedBy, MetricComparison, SpendBreakdown } from "@/lib/monitoring/types";
import { classifyDeviation, downgrade, maxSeverity, minSeverity, severityRank, upgrade } from "./severity";

/**
 * AnomalyEngine: evalúa gasto, resultados (conversiones, leads, ventas, WhatsApp, llamadas),
 * costo por resultado (CPA/CPL), CTR, CPC y CPM. No usa solo porcentajes: combina volumen,
 * variabilidad histórica, hora del día, frescura del dato, objetivo de campaña y peso en el gasto.
 */

const TYPE_FAMILY: Record<AnomalyType, AnomalyFamily> = {
  ABSOLUTE_TOP_BELOW: "absolute_top", ABSOLUTE_TOP_DROP: "absolute_top",
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
  ABSOLUTE_TOP_BELOW: "Absolute Top debajo del mínimo", ABSOLUTE_TOP_DROP: "Caída súbita de Absolute Top",
  DATA_ISSUE: "Problema de datos",
  DELIVERY_CRITICAL: "Paro de entrega",
  PLATFORM_INCIDENT: "Incidente de plataforma",
  DELIVERY_ISSUE: "Caída de entrega",
  UNDERSPEND: "Bajo delivery",
  OVERSPEND: "Sobreinversión",
  TRACKING_ISSUE: "Problema de medición",
  PERFORMANCE_ISSUE: "Caída de resultados",
  EFFICIENCY_ISSUE: "Eficiencia baja",
  COST_INCREASE: "Incremento de costo",
  PACING_DEVIATION: "Desviación de pacing",
};

/** Tipos que se agrupan bajo un padre con tipo compatible (anti-spam jerárquico). */
const SPEND_DROP_TYPES: AnomalyType[] = ["DELIVERY_ISSUE", "UNDERSPEND"];
/** Resultados peores que el gasto: misma causa raíz vista como caída de resultados o como costo al alza. */
const RESULT_DROP_TYPES: AnomalyType[] = ["PERFORMANCE_ISSUE", "COST_INCREASE"];
/** Se juzgan con el gasto esperado a la hora de corte, que depende de la curva horaria. */
const CURVE_TYPES: AnomalyType[] = ["DELIVERY_ISSUE", "UNDERSPEND", "OVERSPEND", "PLATFORM_INCIDENT"];
/** Caídas de gasto que el desglose por campaña puede explicar (pausas, rotación) o agravar (apagado masivo). */
const STOP_EXPLAINED_TYPES: AnomalyType[] = ["DELIVERY_CRITICAL", "DELIVERY_ISSUE", "UNDERSPEND"];
/** Cambios de gasto de una cuenta que pueden ser presupuesto movido a otra cuenta de la misma plataforma. */
const REALLOCATION_TYPES: AnomalyType[] = ["DELIVERY_ISSUE", "UNDERSPEND", "OVERSPEND"];
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

/** Piso absoluto de gasto esperado a la hora de corte para evaluar una plataforma o cuenta (MXN). */
const MIN_SCOPE_SPEND_FLOOR = 500;

function minSpendFor(e: EntityEvaluation, s: MonitoringSettings) {
  if (e.level === "campaign") return s.volume.minCampaignSpend;
  const base = e.level === "platform" ? s.volume.minPlatformSpend : s.volume.minCampaignSpend;
  // Plataformas y cuentas chicas (p. ej. Bing o TikTok con 5-6 mil MXN al día) también se vigilan: el
  // mínimo es la quinta parte de su propio gasto diario típico, con un piso absoluto.
  const expected = e.cumulative.spend?.expected ?? null;
  const dailyTypical = expected !== null && e.dayShare !== null && e.dayShare > 0 ? expected / e.dayShare : null;
  return dailyTypical === null ? base : Math.min(base, Math.max(MIN_SCOPE_SPEND_FLOOR, 0.2 * dailyTypical));
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
const SEVERITY_LABEL: Record<Severity, string> = { NORMAL: "Normal", ATTENTION: "Atención", ALERT: "Alerta", CRITICAL: "Crítico" };

function adjust(a: Anomaly, e: EntityEvaluation, ctx: AnomalyContext): Anomaly {
  const { settings } = ctx;
  if (a.type === "DATA_ISSUE") return a;
  let s = a.severity;
  let explained: ExplainedBy | null = null;
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
    // Hoy sigue en ese nivel (o menos extremo): no es una falla de hoy, es su nivel actual.
    const sameOrBetter = rel !== null && (Math.abs(rel) < t.attention || (lvl.direction === "down" ? rel > 0 : rel < 0));
    // Un cambio fuerte (la mitad o el doble) no se da por bueno solo por durar: queda en Alerta hasta que
    // alguien lo explique en Novedades o la plataforma confirme las pausas.
    const severe = lvl.direction === "down" ? lvl.ratio <= 0.5 : lvl.ratio >= 2;
    if (sameOrBetter && severe) {
      s = minSeverity(s, "ALERT");
      notes.push(`${since} y hoy sigue en ese nivel${rel !== null && Math.abs(rel) >= t.attention ? ` (${pct(rel)} contra él)` : ""}. Es un cambio fuerte: si fue planeado, regístralo en Novedades para dejar de alertar; si no, revisar.`);
    } else if (sameOrBetter) {
      s = minSeverity(s, "ATTENTION");
      explained = "sustained";
      notes.push(`${since} y hoy sigue en ese nivel: parece un cambio de presupuesto o de estrategia, no una falla de hoy. Si no fue planeado, revisar.`);
    } else if (rel !== null) {
      s = minSeverity(s, maxSeverity(classifyDeviation(Math.abs(rel), t), "ATTENTION"));
      notes.push(`${since}; hoy va ${pct(rel)} contra ese nivel.`);
    }
  }
  if (e.resultLagging && a.family === "delivery") {
    notes.push(`${e.kpi.resultLabel} de ${PLATFORMS[e.platform].shortName} llegan con retraso (conversiones offline): en el día solo se evalúa el gasto.`);
  }
  // Estado que reporta la plataforma para la campaña (columna de estado de la hoja).
  if (e.level === "campaign" && e.statusSource === "platform") {
    const where = PLATFORMS[e.platform].shortName;
    if (e.statusSilent && a.family === "delivery" && severityRank(s) > severityRank("ALERT")) {
      s = "ALERT";
      notes.push(`${where} la reporta activa ("${e.statusText}") pero no gasta desde ayer: revisar si se apagaron sus conjuntos o anuncios, el pago o la aprobación. Severidad limitada a ALERTA.`);
    } else if (e.statusIssue) {
      notes.push(`Estado en ${where}: "${e.statusText}".`);
    }
  }
  // Criterios para no llenar de alertas: tope de severidad según qué mide y a qué nivel.
  const cap = (limit: Severity, note: string) => {
    if (severityRank(s) <= severityRank(limit)) return;
    s = limit;
    notes.push(`${note} Se limita a ${SEVERITY_LABEL[limit]}.`);
  };
  if (a.type === "EFFICIENCY_ISSUE" || a.type === "COST_INCREASE") {
    cap(e.level === "platform" ? "ALERT" : "ATTENTION", `${e.kpi.costLabel} es una métrica secundaria en el día (las decisiones se toman con resultados y gasto).`);
  }
  if (a.type === "OVERSPEND" && e.level !== "platform") {
    cap(e.level === "account" ? "ALERT" : "ATTENTION", "Gastar más de lo usual en una cuenta o campaña suele ser una decisión de escala; el riesgo de pasarse se vigila contra presupuesto a nivel plataforma.");
  }
  if (e.level === "campaign") {
    // Crítico se reserva para una cuenta o plataforma completa; una campaña con poco peso queda en Atención.
    const material = (e.expectedSpendShare ?? 0) >= settings.detection.campaignMinShare;
    cap(
      material ? "ALERT" : "ATTENTION",
      a.type === "DELIVERY_CRITICAL" ? "Una campaña sola sin gasto no es un paro de la cuenta: Crítico se reserva para una cuenta o plataforma completa." : "Una campaña sola: Crítico se reserva para una cuenta o plataforma completa.",
    );
  }
  return { ...a, severity: s, adjustments: notes, explained };
}

/**
 * Aplica el veredicto del desglose por campaña a una caída o subida de gasto de cuenta o plataforma:
 * un apagado masivo siempre es crítico; pausas del equipo o una rotación de campañas con el resto
 * normal quedan en Atención; si solo se explica una parte, manda lo que hace el resto.
 */
function applyVerdict(a: Anomaly, b: SpendBreakdown, e: EntityEvaluation, ctx: AnomalyContext) {
  const note = (text: string) => (a.adjustments = [...a.adjustments, text]);
  const drop = STOP_EXPLAINED_TYPES.includes(a.type) || a.type === "PLATFORM_INCIDENT";
  // "De golpe" = ayer todavía gastaba. Si ayer ya estaba apagada, es su nivel actual.
  const stoppedBefore = a.explained === "sustained" || (e.previousDayRatio !== null && e.previousDayRatio !== undefined && e.previousDayRatio <= 1 - ctx.settings.detection.massStopShare);
  if (drop && b.verdict === "mass_stop" && stoppedBefore) {
    // Ya venía apagada: no es "de golpe". Si la plataforma confirma las pausas es Atención; si no, Alerta
    // hasta que se explique en Novedades.
    const confirmed = b.groups.stopped.count === 0;
    a.severity = minSeverity(a.severity, confirmed ? "ATTENTION" : "ALERT");
    a.explained = confirmed ? "planned_stop" : null;
    note(
      `${b.summary} Ya estaba apagada desde antes (ayer gastó ${Math.round((e.previousDayRatio ?? 0) * 100)}% de lo normal): no es un apagado de hoy.${confirmed ? "" : " Si fue planeado, regístralo en Novedades para dejar de alertar."}`,
    );
  } else if (drop && b.verdict === "mass_stop") {
    a.severity = "CRITICAL";
    note(`${b.summary} Apagado masivo: aunque sean pausas, se reporta como crítico. Si el equipo lo autorizó, márcalo como cambio autorizado para dejar de alertar.`);
  } else if (drop && (b.verdict === "planned_stop" || b.verdict === "rotation")) {
    a.severity = minSeverity(a.severity, "ATTENTION");
    a.explained = b.verdict;
    note(`${b.summary} Se lee como un cambio del equipo: queda en Atención. Si no fue planeado, revisar.`);
  } else if (drop && b.verdict === "partial_stop") {
    a.severity = minSeverity(a.severity, b.stoppedShare >= 0.5 ? "ALERT" : "ATTENTION");
    note(`${b.summary} La hoja no confirma que se hayan pausado a propósito; si fue planeado, márcalo como cambio autorizado.`);
  } else if (drop && b.verdict === "mixed" && b.restDeviation !== null && b.groups.stopped.count === 0) {
    // Solo se descuentan las pausas confirmadas por la plataforma: lo demás sigue siendo parte del problema.
    a.severity = minSeverity(a.severity, maxSeverity(classifyDeviation(Math.abs(b.restDeviation), ctx.settings.thresholds), "ATTENTION"));
    note(`${b.summary} Sin las pausadas, la severidad sale de lo que hacen las campañas activas.`);
  } else if (drop && b.verdict === "mixed") {
    note(b.summary);
  } else if (a.type === "OVERSPEND" && b.verdict === "launch") {
    a.severity = minSeverity(a.severity, "ATTENTION");
    a.explained = "launch";
    note(`${b.summary} Queda en Atención: revisar que esté dentro del presupuesto.`);
  }
}

function dataIssue(e: EntityEvaluation): Anomaly {
  const state = e.dataState;
  const label = state === "ERROR" ? "Error de sincronización" : state === "NO_DATA" ? "Sin datos" : "Datos atrasados";
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

  // ¿Qué pasó? Desglose por campaña de cada caída o subida de gasto de cuenta o plataforma.
  for (const a of out) {
    if (a.level === "campaign" || a.family !== "delivery") continue;
    const e = byKey.get(a.key);
    if (!e) continue;
    const recent = a.type === "DELIVERY_CRITICAL" && e.recent?.spend !== undefined && a.expected === e.recent.spend.expected;
    const b = spendBreakdown(e, evaluations, ctx.settings, recent ? "recent" : "day");
    if (!b) continue;
    a.breakdown = b;
    applyVerdict(a, b, e, ctx);
  }

  // Reasignación: una cuenta baja y otra de la misma plataforma sube el mismo día, con el total normal.
  const t = ctx.settings.thresholds;
  const gapOf = (e: EntityEvaluation) => (e.cumulative.spend?.current ?? 0) - (e.cumulative.spend?.expected ?? 0);
  for (const p of PLATFORM_IDS) {
    const pd = byKey.get(`platform:${p}`)?.cumulative.spend?.deltaVsExpected;
    if (pd === null || pd === undefined || Math.abs(pd) >= t.attention) continue;
    const accounts = evaluations.filter((e) => e.level === "account" && e.platform === p && (e.dataState === "OK" || e.dataState === "PARTIAL"));
    for (const a of out) {
      if (a.level !== "account" || a.platform !== p || !REALLOCATION_TYPES.includes(a.type)) continue;
      // Un apagado masivo de hoy se reporta aunque el presupuesto se haya movido (se autoriza si fue planeado).
      if (a.breakdown?.verdict === "mass_stop" && a.explained !== "sustained") continue;
      const e = byKey.get(a.key);
      if (!e) continue;
      const gap = gapOf(e);
      const others = accounts.filter((o) => o.key !== a.key && Math.sign(gapOf(o)) === -Math.sign(gap)).sort((x, y) => Math.abs(gapOf(y)) - Math.abs(gapOf(x)));
      const offset = others.reduce((acc, o) => acc + gapOf(o), 0);
      if (!others.length || Math.abs(offset) < 0.5 * Math.abs(gap)) continue;
      const shown = others.slice(0, 2);
      const names = shown.map((o) => o.accountName ?? o.accountId).join(" y ");
      const verb = gap < 0 ? (shown.length > 1 ? "subieron" : "subió") : shown.length > 1 ? "bajaron" : "bajó";
      a.severity = minSeverity(a.severity, "ATTENTION");
      a.explained = "reallocation";
      a.adjustments = [
        ...a.adjustments,
        `Reasignación entre cuentas: ${names} ${verb} ${Math.round(Math.abs(offset)).toLocaleString("es-MX")} MXN el mismo día y el total de ${PLATFORMS[p].shortName} va ${pct(pd)}: el presupuesto se movió, no se perdió. Queda en Atención.`,
      ];
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
    // Un apagado masivo no depende de la curva: casi todo el gasto esperado está detenido.
    if (a.breakdown?.verdict === "mass_stop" && a.severity === "CRITICAL") continue;
    // Una desviación grande (más que el umbral crítico) no la explica un error de curva: queda en Alerta.
    const big = a.deviation !== null && Math.abs(a.deviation) >= ctx.settings.thresholds.critical;
    const capped = big ? minSeverity(a.severity, "ALERT") : maxSeverity(minSeverity(downgrade(a.severity), "ALERT"), "ATTENTION");
    if (capped === a.severity) continue;
    a.severity = capped;
    a.adjustments = [
      ...a.adjustments,
      big
        ? "La hoja solo trae el acumulado del día: el esperado a esta hora sale de una curva típica. Por eso llega como máximo a Alerta (la desviación es demasiado grande para ser un error de curva)."
        : "La hoja solo trae el acumulado del día: el esperado a esta hora sale de una curva típica, no de datos por hora. Severidad reducida un nivel hasta tener la consulta por hora de Dataslayer.",
    ];
  }

  // Anti-spam jerárquico: una anomalía hija con el mismo tipo que su padre se agrupa bajo él.
  const compatible = (child: Anomaly, parent: Anomaly) => {
    // Una campaña sin gasto o cayendo se agrupa bajo la caída de su cuenta o plataforma (una sola alerta con el desglose).
    if (STOP_EXPLAINED_TYPES.includes(child.type)) return [...STOP_EXPLAINED_TYPES, "PLATFORM_INCIDENT"].includes(parent.type);
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

  // Las campañas de un cambio explicado en su cuenta o plataforma no pesan más que él.
  const byFingerprint = new Map(out.map((a) => [a.fingerprint, a]));
  for (const a of out) {
    const parent = a.groupedUnder ? byFingerprint.get(a.groupedUnder) : undefined;
    if (!parent?.explained || severityRank(a.severity) <= severityRank(parent.severity)) continue;
    a.severity = parent.severity;
    a.explained = parent.explained;
    a.adjustments = [...a.adjustments, "Es parte del cambio explicado en su cuenta o plataforma."];
  }

  // Materialidad: una campaña tiene alerta propia solo si es Alerta o más y pesa lo suficiente en su
  // plataforma. Las demás se ven dentro de la alerta de su cuenta (desglose) y en Campañas.
  const { campaignMinShare } = ctx.settings.detection;
  const kept = out.filter(
    (a) => a.level !== "campaign" || a.groupedUnder !== null || a.type === "DATA_ISSUE" || (severityRank(a.severity) >= severityRank("ALERT") && (a.expectedSpendShare ?? 0) >= campaignMinShare),
  );
  return kept.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
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
