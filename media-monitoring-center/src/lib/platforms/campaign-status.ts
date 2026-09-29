import type { CampaignStatus } from "@/lib/types";

export interface ParsedCampaignStatus {
  status: CampaignStatus;
  /** "platform": viene de la columna de estado de la plataforma; "spend": se dedujo por el gasto. */
  source: "platform" | "spend";
  /** Texto tal como lo reporta la plataforma (ENABLED, CAMPAIGN_STATUS_DISABLE, Not delivering…). */
  text: string | null;
  /** Estado con problema de entrega: en revisión, rechazada, sin pago, pausada por presupuesto… */
  issue: boolean;
  /** La plataforma la reporta activa pero no gastó ni ayer ni hoy (p. ej. conjuntos apagados). */
  silent: boolean;
}

const ENDED = /REMOV|ELIMIN|ARCHIV|DELET|BORRAD|COMPLET|FINALIZ|TERMIN|EXPIR|CADUC/;
const PAUSED = /PAUS|DISABL|INACTIV|SUSPEND|DETENID|INHABIL|DESACTIV|APAGAD/;
const ACTIVE = /ACTIV|ENABL|HABILIT|ELIGIBLE|SERVING|DELIVER|RUNNING|LEARNING|APRENDIZAJE|EN CURSO/;
const ISSUE = /ISSUE|DISAPPROV|REJECT|RECHAZ|ERROR|BILLING|PAYMENT|PAGO|PENDING|REVIEW|REVISION|IN_PROCESS|BUDGET|PRESUPUEST|NOT[ _]?DELIVER|NOT[ _]?ELIGIBLE|MISCONFIG|SIN ENTREGA|NO SE ENTREGA|SUSPEND|FAIL/;

/**
 * Estado de una campaña a partir del texto de la plataforma (Google, Meta, TikTok, Microsoft,
 * Spotify, en inglés o español). Sin columna de estado, o con un texto que no se reconoce, se
 * deduce por el gasto: activa si gastó hoy o ayer.
 */
export function parseCampaignStatus(raw: string | null | undefined, recentSpend: number): ParsedCampaignStatus {
  const text = raw?.trim() || null;
  const inferred: ParsedCampaignStatus = { status: recentSpend > 0 ? "ACTIVE" : "PAUSED", source: "spend", text, issue: false, silent: false };
  if (!text) return inferred;
  const s = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  // "END" solo como palabra: PENDING o SPENDING no son campañas terminadas.
  const words = new Set(s.split(/[^A-Z]+/).filter(Boolean));
  const issue = ISSUE.test(s) || words.has("LIMITED");
  if (ENDED.test(s) || words.has("END") || words.has("ENDED") || words.has("FINISHED")) return { status: "ENDED", source: "platform", text, issue: false, silent: false };
  if (PAUSED.test(s) || words.has("OFF") || words.has("STOPPED")) return { status: "PAUSED", source: "platform", text, issue, silent: false };
  if (ACTIVE.test(s) || words.has("ON") || issue) return { status: "ACTIVE", source: "platform", text, issue, silent: recentSpend <= 0 };
  return inferred;
}

/** Pausa hecha a propósito (no por presupuesto agotado, pago o rechazo): explica una caída de gasto. */
export function isIntentionalStop(c: { status: CampaignStatus | null; statusSource?: "platform" | "spend"; statusIssue?: boolean }): boolean {
  return (c.status === "PAUSED" || c.status === "ENDED") && c.statusSource === "platform" && !c.statusIssue;
}
