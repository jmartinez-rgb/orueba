import "server-only";
import { randomUUID } from "node:crypto";
import { DEFAULT_BRAND, type BrandId } from "@/lib/brands";
import type { AuditVerdict, IncidentReview } from "@/lib/audit/incident-audit";
import { getRecordStore, mapLimit } from "./store";

/**
 * Dictámenes de auditoría por incidente (`incident-audits/<marca>/<incidente>`). Se conserva el
 * historial de los últimos 50 dictámenes: cada nuevo dictamen se agrega y el último
 * es el vigente. La escritura por clave preserva los dictámenes concurrentes.
 */
interface ReviewRecord {
  incidentId: string;
  brand: BrandId;
  current: IncidentReview;
  history: IncidentReview[];
  /** Internal deduplication receipt; old records do not contain it. */
  appliedOperations?: string[];
}

const key = (brand: BrandId, incidentId: string) => `incident-audits/${brand}/${encodeURIComponent(incidentId)}`;

export const AUDIT_VERDICTS: AuditVerdict[] = ["CUMPLE", "OBSERVACION", "NO_CUMPLE"];
export const AUDIT_VERDICT_LABEL: Record<AuditVerdict, string> = { CUMPLE: "Cumple", OBSERVACION: "Con observación", NO_CUMPLE: "No cumple" };

export async function saveReview(brand: BrandId, input: Omit<IncidentReview, "at">): Promise<IncidentReview> {
  const store = getRecordStore();
  const review: IncidentReview = { ...input, comment: input.comment.slice(0, 2000), at: new Date().toISOString() };
  const operationId = randomUUID();
  await store.update<ReviewRecord>(key(brand, input.incidentId), prev => {
    // A transport retry can return 412 after the first write was applied. Replaying
    // this append must preserve newer reviews without appending ours twice.
    if (prev?.appliedOperations?.includes(operationId)) return prev;
    return {
      incidentId: input.incidentId,
      brand,
      current: review,
      history: [...(prev?.history ?? []), review].slice(-50),
      appliedOperations: [...(prev?.appliedOperations ?? []), operationId].slice(-50),
    } satisfies ReviewRecord;
  });
  return review;
}

export async function listReviews(brand: BrandId = DEFAULT_BRAND): Promise<Record<string, IncidentReview>> {
  const store = getRecordStore();
  const keys = await store.list(`incident-audits/${brand}/`);
  const rows = await mapLimit(keys, 16, (k) => store.get<ReviewRecord>(k));
  return Object.fromEntries(rows.filter((r): r is ReviewRecord => r !== null).map((r) => [r.incidentId, r.current]));
}

export async function reviewHistory(brand: BrandId, incidentId: string): Promise<IncidentReview[]> {
  return (await getRecordStore().get<ReviewRecord>(key(brand, incidentId)))?.history ?? [];
}
