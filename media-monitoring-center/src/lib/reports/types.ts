import type { PlatformId } from "@/lib/types";

/** Semáforo del mensaje de WhatsApp: 🟢 bien · 🟠 hay observaciones · 🔴 problema. */
export type ReportStatus = "ok" | "warn" | "bad";

export const STATUS_EMOJI: Record<ReportStatus, string> = { ok: "🟢", warn: "🟠", bad: "🔴" };

export interface CampaignGroup {
  account: string;
  campaigns: string[];
}

export interface PlatformReportData {
  platform: PlatformId;
  /** Nombre con el que el equipo llama a la plataforma en el mensaje (Meta = "Facebook"). */
  name: string;
  activeStatus: ReportStatus;
  conversionStatus: ReportStatus;
  engineSeverity: "NORMAL" | "ATTENTION" | "ALERT" | "CRITICAL";
  dataIssue: string | null;
  spendLowerVsLastWeek: string[];
  spendHigherVsLastWeek: string[];
  spendLowerVsYesterday: string[];
  spendHigherVsYesterday: string[];
  zeroSpend: Array<{ campaign: string; account: string }>;
  campaignsHigherVsYesterday: CampaignGroup[];
  conversionDropVsLastWeek: string[];
  conversionDropVsYesterday: string[];
  /** Métrica que se reporta como "conversiones" y su etiqueta. */
  metricLabel: string;
  conversionsByAccount: Array<{ account: string; value: number | null }>;
  /** Incidentes críticos abiertos (para mencionarlos). */
  criticalIncidents: string[];
}

export interface ReportData {
  generatedAt: string;
  businessDate: string;
  cutoffHour: number;
  timezone: string;
  lastWeekDay: string;
  /** "Buenos días" / "Buenas tardes" / "Buenas noches" según la hora. */
  greeting: string;
  budget: { status: ReportStatus; details: string[] };
  platformProblems: { status: ReportStatus; details: string[] };
  platforms: PlatformReportData[];
  confidence: number;
  thresholds: { spendIncreaseVsYesterday: number; spendChangeVsLastWeek: number; conversionDrop: number };
  manualChecks: Array<{ id: string; label: string }>;
  closingNote: string;
  accountBreakdown: PlatformId[];
}

export interface ReportOptions {
  /** Estados manuales (Zapier, línea de crédito) o correcciones de un estado automático. */
  overrides: Record<string, ReportStatus>;
  includeConfidence: boolean;
  platforms: PlatformId[];
}
