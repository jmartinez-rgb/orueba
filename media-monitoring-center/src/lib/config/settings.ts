import { z } from "zod";
import type { CampaignObjective, PlatformId, Severity } from "@/lib/types";
import { DEFAULT_CLASSIFIERS } from "@/lib/classifiers/defaults";

/**
 * Configuración operativa del monitoreo. Todo lo que un Paid Media Manager podría querer
 * ajustar vive aquí (umbrales, frecuencia, histórico, zona horaria, destinatarios...).
 * Los valores por defecto se pueden sobrescribir desde Settings (persistencia vía SettingsStore).
 */

const severity = z.enum(["NORMAL", "ATTENTION", "ALERT", "CRITICAL"]);
const platformEnum = z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]);
/** Métricas que pueden ser "la métrica monitoreada" (resultado con su costo por resultado). */
export const KPI_METRICS = ["conversions", "sales", "whatsapp", "leads", "calls", "purchases", "clicks", "impressions"] as const;
const kpiMetric = z.enum(KPI_METRICS);
export const ALL_METRIC_IDS = ["spend", "impressions", "clicks", "conversions", "leads", "sales", "whatsapp", "calls", "purchases", "revenue", "cpr", "cpa", "cpl", "roas", "ctr", "cpc", "cpm"] as const;
const metricId = z.enum(ALL_METRIC_IDS);

const classifierSchema = z.object({
  rules: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        contains: z.string().trim().min(1).max(80),
        field: z.enum(["campaign", "secondary"]),
        label: z.string().trim().min(1).max(60),
      }),
    )
    .max(60),
  fallback: z.object({ type: z.enum(["label", "secondary", "objective"]), label: z.string().max(60) }),
  secondaryLabel: z.string().max(120),
});

export const settingsSchema = z.object({
  timezone: z.string().min(1),
  schedule: z.object({
    intervalHours: z.number().int().min(1).max(12),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  }),
  history: z.object({
    /** Semanas del mismo día de la semana que forman la referencia. */
    weeks: z.number().int().min(1).max(12),
    /** Cómo se calcula el valor esperado a partir de las semanas de referencia. */
    baseline: z.enum(["mean", "median"]),
    /** Mínimo de semanas con dato para evaluar. Si hay menos: "histórico insuficiente". */
    minSamples: z.number().int().min(1).max(12),
  }),
  thresholds: z.object({
    attention: z.number().min(0.01).max(1),
    alert: z.number().min(0.01).max(2),
    critical: z.number().min(0.01).max(5),
  }),
  freshness: z.object({
    /** A partir de cuántos minutos sin datos una fuente se considera DATA DELAYED. */
    delayedAfterMinutes: z.number().int().min(10),
    /** A partir de cuántos minutos el atraso es crítico. */
    criticalAfterMinutes: z.number().int().min(30),
    /** Un dato recibido hasta N minutos antes del cierre de la hora cuenta como hora completa. */
    cutoffToleranceMinutes: z.number().int().min(0).max(59),
  }),
  volume: z.object({
    minCampaignSpend: z.number().min(0),
    minCampaignResults: z.number().min(0),
    minPlatformSpend: z.number().min(0),
    minPlatformResults: z.number().min(0),
  }),
  detection: z.object({
    /** Antes de esta hora hay poco volumen: la severidad baja un nivel. */
    earlyHour: z.number().int().min(0).max(23),
    /** Si a la hora de corte suele haber ocurrido menos de esta parte del día, la severidad baja un nivel. */
    earlyDayShare: z.number().min(0).max(0.6),
    /** Si |z| del histórico es menor a esto, la desviación se considera ruido normal y baja un nivel. */
    zScoreFloor: z.number().min(0),
    /** Participación mínima del gasto de la plataforma para que una campaña cambie el color de su plataforma a ALERTA. */
    materialShare: z.number().min(0).max(1),
    /** Campañas cayendo al mismo tiempo para declarar incidente de plataforma. */
    platformIncidentMinCampaigns: z.number().int().min(2),
    /** Participación mínima (del gasto esperado) de las campañas que caen para declarar incidente de plataforma. */
    platformIncidentMinShare: z.number().min(0).max(1),
    /** Caída en la ventana reciente (últimas horas) que se considera "dejó de gastar". */
    stoppedSpendDrop: z.number().min(0.5).max(1),
    /** Días completos seguidos con el mismo cambio de gasto para tomarlo como un nuevo nivel (cambio sostenido). */
    sustainedDays: z.number().int().min(2).max(7),
    /** Parte del gasto esperado de una cuenta o plataforma que, detenida de golpe, se reporta como apagado masivo (crítico). */
    massStopShare: z.number().min(0.5).max(1).default(0.9),
    /** Peso mínimo en el gasto esperado de su plataforma para que una campaña tenga alerta propia (el resto se ve dentro de su cuenta). */
    campaignMinShare: z.number().min(0).max(0.5).default(0.05),
    /** Métricas que llegan con retraso por plataforma (conversiones offline): en el día no se evalúan. */
    laggingMetrics: z.partialRecord(platformEnum, z.array(metricId)),
  }),
  alerts: z.object({
    /** Severidad a partir de la cual una anomalía se vuelve incidente en la primera detección. */
    incidentMinSeverity: severity,
    /** Evaluaciones consecutivas para convertir en incidente una anomalía de menor severidad. */
    persistRunsForIncident: z.number().int().min(1).max(12),
    /** Severidad mínima para notificar (WhatsApp / email). */
    notifyMinSeverity: severity,
    /** Empeoramiento (puntos porcentuales de desviación) que amerita nueva notificación. */
    worsenDeltaPts: z.number().min(0.01).max(1),
    /** Horas abiertas tras las que se envía un recordatorio de escalamiento (una sola vez). */
    escalateAfterHours: z.number().min(1).max(72),
    notifyRecovery: z.boolean(),
  }),
  budget: z.object({
    /** Pronóstico de cierre por encima del presupuesto que amerita atención / alerta / crítico. */
    overspendAttention: z.number().min(0).max(1),
    overspendAlert: z.number().min(0).max(1),
    overspendCritical: z.number().min(0).max(2),
    /** Pronóstico por debajo del presupuesto (subejercicio). */
    underspendAttention: z.number().min(0).max(1),
    underspendAlert: z.number().min(0).max(1),
  }),
  recipients: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      channel: z.enum(["whatsapp", "email"]),
      address: z.string(),
      minSeverity: severity,
      platforms: z.union([z.literal("all"), z.array(z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]))]),
      active: z.boolean(),
    }),
  ),
  /** Objetivo asignado manualmente a campañas (sobrescribe el detectado). */
  objectiveOverrides: z.record(
    z.string(),
    z.enum(["SALES", "LEADS", "WHATSAPP", "CALLS", "TRAFFIC", "ENGAGEMENT", "VIDEO", "AWARENESS", "PURCHASES", "CONVERSIONS"]),
  ),
  /** Métrica monitoreada por plataforma (resultado principal) y métricas fijas que siempre se muestran. */
  platformMetrics: z.partialRecord(platformEnum, z.object({ primary: kpiMetric, pinned: z.array(metricId).max(6) })),
  /** Objetivos fijos opcionales (p. ej. CPA máximo o conversiones mínimas por día). Solo informan: no cambian nada en plataforma. */
  fixedTargets: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        platform: platformEnum,
        accountId: z.string().max(80).nullable(),
        metric: metricId,
        kind: z.enum(["min", "max"]),
        value: z.number().min(0).max(1e12),
        active: z.boolean(),
        note: z.string().max(200),
      }),
    )
    .max(80),
  /** Moneda: todo se reporta en MXN; las cuentas en USD se convierten con la tasa del mes. */
  currency: z.object({
    /** 1 USD = N MXN por mes (YYYY-MM). La tasa cambia cada mes. */
    rates: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().positive().max(1000)),
    /** Corrección de la moneda de una cuenta (si la fuente no la trae o viene mal). */
    accountCurrency: z.record(z.string(), z.enum(["MXN", "USD"])),
  }),
  /** Nivel de presupuesto confirmado por cuenta: a nivel cuenta o por campaña. */
  budgetLevels: z.record(z.string(), z.enum(["account", "campaign"])),
  /** Clasificadores de estrategia por plataforma (fórmulas por nombre de campaña). */
  classifiers: z.partialRecord(platformEnum, classifierSchema),
  /** Cómo llegan los datos: API directa (n8n) o Google Sheets (Dataslayer + Apps Script) → BigQuery. */
  ingestion: z.partialRecord(platformEnum, z.enum(["api", "sheets"])),
  /** Plataformas que se monitorean (las demás no se evalúan ni se muestran). Con Google Sheets, las que trae la hoja. */
  monitoredPlatforms: z.array(platformEnum).min(1).max(6),
  /** Mensaje de monitoreo para WhatsApp (se copia y envía manualmente). */
  report: z.object({
    platforms: z.array(platformEnum).min(1).max(6),
    /** Gasto mayor al de ayer (misma franja) a partir de este porcentaje. */
    spendIncreaseVsYesterday: z.number().min(0.05).max(3),
    /** Variación de gasto vs el mismo día de la semana pasada que se reporta. */
    spendChangeVsLastWeek: z.number().min(0.05).max(3),
    /** Caída de conversiones (vs semana pasada o vs ayer) que se reporta como fuerte. */
    conversionDrop: z.number().min(0.05).max(1),
    /** Métrica de "conversiones" por plataforma para el mensaje (si no se define, la métrica monitoreada). */
    conversionMetric: z.partialRecord(platformEnum, kpiMetric),
    /** Plataformas cuyo detalle por cuenta ("👥 Conversiones … al momento en <cuenta>") se incluye. */
    accountBreakdown: z.array(platformEnum).max(6),
    /** Revisiones manuales que se marcan en cada mensaje (Zapier, línea de crédito…). */
    manualChecks: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1).max(80) })).max(12),
    closingNote: z.string().max(400),
  }),
});

export type MonitoringSettings = z.infer<typeof settingsSchema>;
export type Recipient = MonitoringSettings["recipients"][number];

export const DEFAULT_SETTINGS: MonitoringSettings = {
  timezone: "America/Mexico_City",
  schedule: { intervalHours: 2, startHour: 7, endHour: 23 },
  history: { weeks: 4, baseline: "mean", minSamples: 2 },
  thresholds: { attention: 0.15, alert: 0.25, critical: 0.4 },
  freshness: { delayedAfterMinutes: 120, criticalAfterMinutes: 360, cutoffToleranceMinutes: 20 },
  volume: { minCampaignSpend: 5000, minCampaignResults: 20, minPlatformSpend: 20000, minPlatformResults: 50 },
  detection: {
    earlyHour: 8,
    earlyDayShare: 0.2,
    zScoreFloor: 1.5,
    materialShare: 0.15,
    platformIncidentMinCampaigns: 3,
    platformIncidentMinShare: 0.4,
    stoppedSpendDrop: 0.9,
    sustainedDays: 3,
    massStopShare: 0.9,
    campaignMinShare: 0.05,
    laggingMetrics: {},
  },
  alerts: {
    incidentMinSeverity: "ALERT",
    persistRunsForIncident: 2,
    notifyMinSeverity: "ALERT",
    worsenDeltaPts: 0.1,
    escalateAfterHours: 6,
    notifyRecovery: true,
  },
  budget: { overspendAttention: 0.05, overspendAlert: 0.1, overspendCritical: 0.2, underspendAttention: 0.1, underspendAlert: 0.2 },
  recipients: [
    {
      id: "rcp-1",
      name: "Guardia Paid Media",
      channel: "whatsapp",
      address: "+52 55 0000 0001",
      minSeverity: "ALERT",
      platforms: "all",
      active: true,
    },
    {
      id: "rcp-2",
      name: "Líder Meta",
      channel: "whatsapp",
      address: "+52 55 0000 0002",
      minSeverity: "CRITICAL",
      platforms: ["meta"],
      active: true,
    },
    {
      id: "rcp-3",
      name: "Equipo Paid Media",
      channel: "email",
      address: "paid-media@example.com",
      minSeverity: "ATTENTION",
      platforms: "all",
      active: true,
    },
  ],
  objectiveOverrides: {},
  platformMetrics: {},
  fixedTargets: [],
  currency: { rates: {}, accountCurrency: {} },
  budgetLevels: {},
  classifiers: DEFAULT_CLASSIFIERS,
  ingestion: { google: "sheets", meta: "sheets", tiktok: "sheets", microsoft: "sheets", spotify: "sheets", x: "sheets" },
  monitoredPlatforms: ["google", "meta", "tiktok", "microsoft", "spotify", "x"],
  report: {
    platforms: ["google", "meta"],
    spendIncreaseVsYesterday: 0.25,
    spendChangeVsLastWeek: 0.15,
    conversionDrop: 0.2,
    conversionMetric: { google: "conversions", meta: "conversions" },
    accountBreakdown: ["meta"],
    manualChecks: [
      { id: "zapier-uso", label: "Uso de tasks en Zapier" },
      { id: "zapier-flujos", label: "Tasks en Zapier (Meta, Discovery AO, Pmax AO)" },
    ],
    closingNote: "De igual manera es importante recordar que el día aún no termina y este gasto mayor al {umbral} puede variar a lo largo del día.",
  },
};

/** Aplica un parche parcial sobre la configuración y valida el resultado. */
export function mergeSettings(base: MonitoringSettings, patch: unknown): MonitoringSettings {
  if (!patch || typeof patch !== "object") return base;
  const merged = deepMerge(base as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const parsed = settingsSchema.safeParse(merged);
  if (!parsed.success) return base;
  const s = parsed.data;
  // Coherencia de umbrales: atención < alerta < crítico.
  if (!(s.thresholds.attention < s.thresholds.alert && s.thresholds.alert < s.thresholds.critical)) return base;
  return s;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Igualdad profunda sin importar el orden de las llaves (la validación las reordena). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
  }
  return false;
}

/**
 * Lo que se guarda: solo lo que difiere de los valores por omisión. Así un valor que la app
 * calcula en el momento (plataformas de la marca, atraso según Dataslayer) nunca queda fijo.
 */
export function settingsDiff(base: MonitoringSettings, next: MonitoringSettings): Record<string, unknown> {
  const walk = (a: unknown, b: unknown): unknown => {
    if (isPlainObject(a) && isPlainObject(b)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(b)) {
        const d = walk(a[k], v);
        if (d !== undefined) out[k] = d;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return same(a, b) ? undefined : b;
  };
  return (walk(base, next) as Record<string, unknown> | undefined) ?? {};
}

/**
 * Aplica lo editado en la pantalla de Configuración sobre lo guardado. La pantalla muestra la
 * configuración vigente (con los ajustes por marca y por hoja ya aplicados); lo que el usuario
 * no tocó conserva el valor guardado para no congelar esos ajustes calculados.
 */
export function applyEditedSettings(stored: MonitoringSettings, effective: MonitoringSettings, submitted: MonitoringSettings): MonitoringSettings | null {
  const out = structuredClone(stored) as unknown as Record<string, unknown>;
  const eff = effective as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(submitted as unknown as Record<string, unknown>)) {
    const e = eff[k];
    const st = out[k];
    if (isPlainObject(v) && isPlainObject(e) && isPlainObject(st)) {
      for (const k2 of new Set([...Object.keys(v), ...Object.keys(e)])) {
        if (!(k2 in v)) delete st[k2];
        else if (!same(v[k2], e[k2])) st[k2] = v[k2];
      }
    } else if (!same(v, e)) out[k] = v;
  }
  const parsed = settingsSchema.safeParse(out);
  return parsed.success ? parsed.data : null;
}

/** Horas de evaluación del día según la frecuencia configurada (p. ej. 07, 09, ..., 23). */
export function evaluationSlots(settings: MonitoringSettings): number[] {
  const { intervalHours, startHour, endHour } = settings.schedule;
  const slots: number[] = [];
  for (let h = startHour; h <= endHour; h += intervalHours) slots.push(h);
  return slots;
}

export type { CampaignObjective, PlatformId, Severity };

/**
 * Rutas que se pueden modificar de forma puntual (PATCH) desde otras pantallas: métrica por
 * plataforma en Overview, nivel de presupuesto en Budget Control, tasas de cambio, etc.
 */
export const PATCHABLE_PATHS = [
  "platformMetrics",
  "fixedTargets",
  "currency.rates",
  "currency.accountCurrency",
  "budgetLevels",
  "classifiers",
  "ingestion",
  "monitoredPlatforms",
  "report",
  "objectiveOverrides",
] as const;

export function isPatchablePath(path: string): boolean {
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(path)) return false;
  return PATCHABLE_PATHS.some((p) => path === p || path.startsWith(`${p}.`));
}

/** Reemplaza (o borra con null) el valor en una ruta "a.b.c" y valida el resultado completo. */
export function setSettingAtPath(base: MonitoringSettings, path: string, value: unknown): MonitoringSettings | null {
  if (!isPatchablePath(path)) return null;
  const clone = structuredClone(base) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let cur: Record<string, unknown> = clone;
  for (const k of keys.slice(0, -1)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") return null;
    const next = cur[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") return null;
  if (value === null) delete cur[last];
  else cur[last] = value;
  const parsed = settingsSchema.safeParse(clone);
  return parsed.success ? parsed.data : null;
}
