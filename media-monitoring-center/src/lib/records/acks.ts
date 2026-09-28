import "server-only";
import { getRecordStore, mapLimit } from "./store";

/**
 * Acuses de alertas críticas: cada persona debe escribir que revisó el incidente crítico y
 * que lo va a reportar. La llave incluye la apertura del incidente para que un ID reutilizado
 * otro día no herede acuses anteriores.
 */

export interface CriticalAck {
  incidentId: string;
  openedAt: string;
  userId: string;
  userName: string;
  at: string;
  text: string;
  reportTo: string;
  ticketId: string | null;
}

export function incidentKey(incidentId: string, openedAt: string) {
  return `${incidentId}@${openedAt.replace(/[-:.]/g, "")}`;
}

const keyFor = (incidentId: string, openedAt: string, userId: string) => `acks/${incidentKey(incidentId, openedAt)}/${encodeURIComponent(userId)}`;

export async function saveAck(ack: CriticalAck): Promise<void> {
  await getRecordStore().set(keyFor(ack.incidentId, ack.openedAt, ack.userId), ack);
}

export async function hasAck(incidentId: string, openedAt: string, userId: string): Promise<boolean> {
  return (await getRecordStore().get<CriticalAck>(keyFor(incidentId, openedAt, userId))) !== null;
}

/** Todos los acuses de un incidente (quién lo revisó y cuándo). */
export async function listAcks(incidentId: string, openedAt: string): Promise<CriticalAck[]> {
  const store = getRecordStore();
  const keys = await store.list(`acks/${incidentKey(incidentId, openedAt)}/`);
  const rows = await mapLimit(keys, 8, (k) => store.get<CriticalAck>(k));
  return rows.filter((a): a is CriticalAck => a !== null).sort((a, b) => a.at.localeCompare(b.at));
}
