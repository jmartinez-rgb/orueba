import type { PlatformId, Severity } from "@/lib/types";

/**
 * Modelo de tickets de reporte (compartido por servidor y navegador; sin acceso a datos).
 */

export type TicketStatus = "ABIERTO" | "REPORTADO" | "EN_SEGUIMIENTO" | "ESCALADO" | "RESUELTO" | "CERRADO";
export const TICKET_STATUSES: TicketStatus[] = ["ABIERTO", "REPORTADO", "EN_SEGUIMIENTO", "ESCALADO", "RESUELTO", "CERRADO"];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  ABIERTO: "Abierto",
  REPORTADO: "Reportado",
  EN_SEGUIMIENTO: "En seguimiento",
  ESCALADO: "Escalado",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};
export const OPEN_TICKET_STATUSES: TicketStatus[] = ["ABIERTO", "REPORTADO", "EN_SEGUIMIENTO", "ESCALADO"];

export type TicketCategory = "DELIVERY" | "TRACKING" | "DATOS" | "PRESUPUESTO" | "PLATAFORMA" | "OTRO";
export const TICKET_CATEGORIES: TicketCategory[] = ["DELIVERY", "TRACKING", "DATOS", "PRESUPUESTO", "PLATAFORMA", "OTRO"];
export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  DELIVERY: "Delivery / gasto",
  TRACKING: "Tracking / conversiones",
  DATOS: "Datos / sincronización",
  PRESUPUESTO: "Presupuesto / línea de crédito",
  PLATAFORMA: "Falla de plataforma",
  OTRO: "Otro",
};

export type TicketChannel = "WHATSAPP" | "EMAIL" | "SOPORTE_PLATAFORMA" | "LLAMADA" | "REUNION" | "OTRO";
export const TICKET_CHANNELS: TicketChannel[] = ["WHATSAPP", "EMAIL", "SOPORTE_PLATAFORMA", "LLAMADA", "REUNION", "OTRO"];
export const TICKET_CHANNEL_LABEL: Record<TicketChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Correo",
  SOPORTE_PLATAFORMA: "Soporte de la plataforma",
  LLAMADA: "Llamada",
  REUNION: "Reunión",
  OTRO: "Otro",
};

export interface TicketUpdate {
  at: string;
  by: string;
  status: TicketStatus | null;
  text: string;
}

export interface Ticket {
  id: string;
  createdAt: string;
  createdBy: string;
  title: string;
  description: string;
  severity: Severity;
  category: TicketCategory;
  platform: PlatformId | null;
  accountName: string | null;
  incidentIds: string[];
  reportedTo: string;
  channel: TicketChannel;
  externalRef: string | null;
  owner: string | null;
  status: TicketStatus;
  updates: TicketUpdate[];
  resolvedAt: string | null;
  closedAt: string | null;
}

export type NewTicket = Pick<Ticket, "title" | "description" | "severity" | "category" | "platform" | "accountName" | "incidentIds" | "reportedTo" | "channel" | "externalRef" | "owner">;
