/** Bugs y sugerencias (tipos compartidos con el navegador; sin acceso a servidor). */

export type FeedbackKind = "BUG" | "SUGERENCIA";
export type FeedbackStatus = "NUEVO" | "EN_REVISION" | "EN_PROCESO" | "RESUELTO" | "DESCARTADO";
export type FeedbackImpact = "BAJO" | "MEDIO" | "ALTO";

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = { BUG: "Bug", SUGERENCIA: "Sugerencia" };
export const FEEDBACK_STATUSES: FeedbackStatus[] = ["NUEVO", "EN_REVISION", "EN_PROCESO", "RESUELTO", "DESCARTADO"];
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  NUEVO: "Nuevo",
  EN_REVISION: "En revisión",
  EN_PROCESO: "En proceso",
  RESUELTO: "Resuelto",
  DESCARTADO: "Descartado",
};
export const FEEDBACK_IMPACTS: FeedbackImpact[] = ["BAJO", "MEDIO", "ALTO"];
export const FEEDBACK_IMPACT_LABEL: Record<FeedbackImpact, string> = { BAJO: "Bajo", MEDIO: "Medio", ALTO: "Alto" };
export const OPEN_FEEDBACK_STATUSES: FeedbackStatus[] = ["NUEVO", "EN_REVISION", "EN_PROCESO"];

export interface FeedbackUpdate {
  at: string;
  by: string;
  status: FeedbackStatus | null;
  text: string;
}

export interface Feedback {
  id: string;
  kind: FeedbackKind;
  title: string;
  description: string;
  /** Sección de la app donde ocurrió o a la que aplica (p. ej. "/monitoreos"). */
  page: string | null;
  impact: FeedbackImpact;
  author: { id: string; name: string; role: string | null };
  agent: string | null;
  createdAt: string;
  status: FeedbackStatus;
  /** Respuesta o nota del administrador. */
  adminNote: string | null;
  updates: FeedbackUpdate[];
  updatedAt: string;
}

export interface NewFeedback {
  kind: FeedbackKind;
  title: string;
  description: string;
  page: string | null;
  impact: FeedbackImpact;
}
