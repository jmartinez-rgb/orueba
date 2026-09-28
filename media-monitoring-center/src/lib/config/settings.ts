import { z } from "zod";
import type { CampaignObjective, PlatformId, Severity } from "@/lib/types";

/**
 * Configuración operativa del monitoreo. Todo lo que un Paid Media Manager podría querer
 * ajustar vive aquí (umbrales, frecuencia, histórico, zona horaria, destinatarios...).
 * Los valores por defecto se pueden sobrescribir desde Settings (persistencia vía SettingsStore).
 */

const severity = z.enum(["NORMAL", "ATTENTION", "ALERT", "CRITICAL"]);

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
    zScoreFloor: 1.5,
    materialShare: 0.15,
    platformIncidentMinCampaigns: 3,
    platformIncidentMinShare: 0.4,
    stoppedSpendDrop: 0.9,
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

/** Horas de evaluación del día según la frecuencia configurada (p. ej. 07, 09, ..., 23). */
export function evaluationSlots(settings: MonitoringSettings): number[] {
  const { intervalHours, startHour, endHour } = settings.schedule;
  const slots: number[] = [];
  for (let h = startHour; h <= endHour; h += intervalHours) slots.push(h);
  return slots;
}

export type { CampaignObjective, PlatformId, Severity };
