import type { PlatformId } from "@/lib/types";
import type { BrandId } from "@/lib/brands";

/**
 * Novedades: ajustes aprobados durante el mes (presupuesto, pausas, activaciones, cambios de
 * plataforma o estrategia). Quedan siempre en el historial y el monitoreo las toma en cuenta:
 * lo que cubre una novedad vigente no se alerta, salvo que empeore más allá de lo aprobado.
 * (Modelo compartido por servidor y navegador; sin acceso a datos.)
 */

export type NovedadKind = "PRESUPUESTO" | "PAUSA" | "ACTIVACION" | "PLATAFORMA" | "ESTRATEGIA" | "ARRANQUE" | "OTRO";
export const NOVEDAD_KINDS: NovedadKind[] = ["PRESUPUESTO", "PAUSA", "ACTIVACION", "PLATAFORMA", "ESTRATEGIA", "OTRO"];
export const NOVEDAD_KIND_LABEL: Record<NovedadKind, string> = {
  PRESUPUESTO: "Ajuste de presupuesto",
  PAUSA: "Pausa o apagado",
  ACTIVACION: "Activación o lanzamiento",
  PLATAFORMA: "Cambio de plataforma o cuenta",
  ESTRATEGIA: "Cambio de estrategia",
  ARRANQUE: "Arranque de mes",
  OTRO: "Otro",
};

export type ApprovalChannel = "WHATSAPP" | "EMAIL" | "LLAMADA" | "REUNION" | "TEAMS" | "OTRO";
export const APPROVAL_CHANNELS: ApprovalChannel[] = ["WHATSAPP", "EMAIL", "LLAMADA", "REUNION", "TEAMS", "OTRO"];
export const APPROVAL_CHANNEL_LABEL: Record<ApprovalChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Correo",
  LLAMADA: "Llamada",
  REUNION: "Reunión",
  TEAMS: "Teams / Slack",
  OTRO: "Otro",
};

export type NovedadStatus = "VIGENTE" | "CERRADA";

export interface NovedadUpdate {
  at: string;
  by: string;
  text: string;
}

export interface Novedad {
  id: string;
  brand: BrandId;
  createdAt: string;
  createdBy: string;
  kind: NovedadKind;
  title: string;
  detail: string;
  /** Alcance: sin plataforma = toda la marca. */
  platform: PlatformId | null;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** Quién aprobó el ajuste, por qué medio y con qué referencia (p. ej. "correo del 3 oct"). */
  approvedBy: string;
  approvalChannel: ApprovalChannel;
  approvalRef: string | null;
  /** Fechas de negocio YYYY-MM-DD. Sin fecha final = todo el mes de inicio. */
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** Nuevo presupuesto mensual del alcance (ajuste de presupuesto). */
  budget: { month: string; amount: number } | null;
  /** Cambio esperado del gasto (fracción: -0.8 = baja 80%). Si empeora más, vuelve a alertar. */
  expectedChange: number | null;
  /** Aprueba apagar todo el alcance (si no, un apagado masivo vuelve a alertar). */
  includesFullStop: boolean;
  /** El monitoreo no alerta cambios de gasto del alcance mientras esté vigente. */
  silenceAlerts: boolean;
  /** Si se registró desde una alerta o incidente. */
  incidentId: string | null;
  alertFingerprint: string | null;
  status: NovedadStatus;
  closedAt: string | null;
  closedBy: string | null;
  updates: NovedadUpdate[];
}

export interface NewNovedad {
  kind: NovedadKind;
  title: string;
  detail: string;
  platform: PlatformId | null;
  accountId: string | null;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  approvedBy: string;
  approvalChannel: ApprovalChannel;
  approvalRef: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  budget: { month: string; amount: number } | null;
  expectedChange: number | null;
  includesFullStop: boolean;
  silenceAlerts: boolean;
  incidentId: string | null;
  alertFingerprint: string | null;
}

/** ¿Aplica en esa fecha de negocio? */
export function novedadActiveOn(n: Pick<Novedad, "status" | "effectiveFrom" | "effectiveUntil">, date: string): boolean {
  if (n.status !== "VIGENTE" || date < n.effectiveFrom) return false;
  const until = n.effectiveUntil ?? `${n.effectiveFrom.slice(0, 7)}-31`;
  return date <= until;
}

export function novedadScopeLabel(n: Pick<Novedad, "platform" | "accountName" | "accountId" | "campaignName" | "campaignId">, platformName?: string): string {
  if (n.campaignName || n.campaignId) return `Campaña ${n.campaignName ?? n.campaignId}`;
  if (n.accountName || n.accountId) return `Cuenta ${n.accountName ?? n.accountId}`;
  if (n.platform) return platformName ?? n.platform;
  return "Toda la marca";
}

// ─── Arranque de mes ─────────────────────────────────────────────────────────

export type KickoffState = "ACTIVE" | "PENDING" | "ENDED";
export const KICKOFF_STATE_LABEL: Record<KickoffState, string> = { ACTIVE: "Activa", PENDING: "Pendiente por iniciar", ENDED: "No corre este mes" };

export interface KickoffItem {
  /** ID de campaña del catálogo, o "pend:<n>" para una campaña que aún no aparece en la hoja. */
  key: string;
  platform: PlatformId;
  accountName: string | null;
  campaignId: string | null;
  name: string;
  state: KickoffState;
  /** Fecha esperada de inicio (pendientes). */
  expectedStart: string | null;
  note: string | null;
  /** Cuándo se detectó gasto por primera vez (pendientes que ya iniciaron). */
  startedAt: string | null;
}

export interface KickoffBudget {
  platform: PlatformId;
  accountId: string | null;
  accountName: string | null;
  amount: number;
}

/** Arranque del mes: presupuestos y qué está activo o pendiente por iniciar, confirmado por un administrador. */
export interface MonthKickoff {
  month: string;
  brand: BrandId;
  confirmedAt: string;
  confirmedBy: string;
  budgets: KickoffBudget[];
  items: KickoffItem[];
  /** Última vez que se marcó cada pendiente como avisado (recordatorio diario). */
  updatedAt: string;
  updatedBy: string;
}
