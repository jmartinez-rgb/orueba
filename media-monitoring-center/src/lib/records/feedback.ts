import "server-only";
import { randomUUID } from "node:crypto";
import { getRecordStore, mapLimit } from "./store";
import { nextRecordId } from "./counter";
import { FEEDBACK_STATUS_LABEL, OPEN_FEEDBACK_STATUSES, type Feedback, type FeedbackStatus, type NewFeedback } from "./feedback-model";

export * from "./feedback-model";

interface StoredFeedback extends Feedback { appliedOperations?: string[] }
function publicFeedback(record: StoredFeedback): Feedback {
  const result = { ...record };
  delete result.appliedOperations;
  return result;
}

/**
 * Bugs y sugerencias del equipo. Cualquier persona con sesión puede enviar uno; solo el
 * administrador los ve, les da seguimiento y responde. Registro interno (Netlify Blobs).
 */

export async function createFeedback(input: NewFeedback, author: Feedback["author"], agent: string | null): Promise<Feedback> {
  const id = await nextRecordId(getRecordStore(), "feedback", "FB");
  const now = new Date().toISOString();
  const fb: Feedback = {
    id,
    kind: input.kind,
    title: input.title.trim().slice(0, 140),
    description: input.description.trim().slice(0, 4000),
    page: input.page?.trim().slice(0, 120) || null,
    impact: input.impact,
    author,
    agent,
    createdAt: now,
    status: "NUEVO",
    adminNote: null,
    updates: [{ at: now, by: author.name, status: "NUEVO", text: "Enviado." }],
    updatedAt: now,
  };
  await getRecordStore().set(`feedback/${id}`, fb);
  return fb;
}

export async function getFeedback(id: string): Promise<Feedback | null> {
  if (!/^FB-\d{4,}$/.test(id)) return null;
  const record = await getRecordStore().get<StoredFeedback>(`feedback/${id}`);
  return record ? publicFeedback(record) : null;
}

export async function updateFeedback(id: string, patch: { status?: FeedbackStatus; adminNote?: string | null }, by: string): Promise<Feedback | null> {
  if (!await getFeedback(id)) return null;
  const now = new Date().toISOString();
  const operationId = randomUUID();
  const updated = await getRecordStore().update<StoredFeedback>(`feedback/${id}`, (current) => {
    if (!current || current.appliedOperations?.includes(operationId)) return current;
    const fb: StoredFeedback = { ...current, updates: [...current.updates] };
    const notes: string[] = [];
    let status: FeedbackStatus | null = null;
    if (patch.status && patch.status !== fb.status) {
      status = patch.status;
      fb.status = patch.status;
      notes.push(`Estado: ${FEEDBACK_STATUS_LABEL[patch.status]}.`);
    }
    if (patch.adminNote !== undefined && (patch.adminNote?.trim() || null) !== fb.adminNote) {
      fb.adminNote = patch.adminNote?.trim().slice(0, 2000) || null;
      notes.push(fb.adminNote ? `Nota: ${fb.adminNote}` : "Nota eliminada.");
    }
    if (!notes.length) return fb;
    fb.updates.push({ at: now, by, status, text: notes.join(" ") });
    fb.updatedAt = now > fb.updatedAt ? now : fb.updatedAt;
    fb.appliedOperations = [...(current.appliedOperations ?? []), operationId].slice(-50);
    return fb;
  });
  return updated ? publicFeedback(updated) : null;
}

export async function listFeedback(): Promise<Feedback[]> {
  const store = getRecordStore();
  const keys = (await store.list("feedback/")).filter((k) => /^feedback\/FB-\d+$/.test(k));
  const rows = await mapLimit(keys, 16, (k) => store.get<StoredFeedback>(k));
  return rows.filter((f): f is StoredFeedback => f !== null).map(publicFeedback).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Enviados por una persona (para que vea que llegaron y su estado, sin ver los de los demás). */
export async function listFeedbackBy(authorId: string): Promise<Feedback[]> {
  return (await listFeedback()).filter((f) => f.author.id === authorId);
}

export async function newFeedbackCount(): Promise<number> {
  return (await listFeedback()).filter((f) => f.status === "NUEVO").length;
}

export async function openFeedbackCount(): Promise<number> {
  return (await listFeedback()).filter((f) => OPEN_FEEDBACK_STATUSES.includes(f.status)).length;
}
