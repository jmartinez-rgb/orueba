import "server-only";
import { randomUUID } from "node:crypto";
import { DEFAULT_BRAND, type BrandId } from "@/lib/brands";
import { cached, invalidate } from "@/lib/data/cache";
import { getRecordStore, mapLimit, RecordStoreError } from "./store";
import { nextRecordId } from "./counter";
import { NOVEDAD_KIND_LABEL, type KickoffItem, type MonthKickoff, type NewNovedad, type Novedad } from "./novedad-model";

export * from "./novedad-model";

interface StoredNovedad extends Novedad { appliedOperations?: string[] }
function publicNovedad(record: StoredNovedad): Novedad {
  const result = { ...record };
  delete result.appliedOperations;
  return result;
}

/**
 * Novedades del mes (ajustes aprobados) y arranque de mes. Registro interno: la app no cambia
 * nada en las plataformas; solo documenta lo aprobado para que el monitoreo lo tome en cuenta.
 */

const LIST_TTL = 15 * 1000;

function changed() {
  invalidate("novedades:");
  invalidate("kickoff:");
  // Lo que el monitoreo toma en cuenta cambió: la evaluación en vivo se recalcula.
  invalidate("live:");
  invalidate("replay:");
  invalidate("brandstatus:");
}

export async function createNovedad(input: NewNovedad, by: string, brand: BrandId = DEFAULT_BRAND): Promise<Novedad> {
  const id = await nextRecordId(getRecordStore(), "novedades", "NOV");
  const now = new Date().toISOString();
  const n: Novedad = {
    id,
    brand,
    createdAt: now,
    createdBy: by,
    kind: input.kind,
    title: input.title.trim().slice(0, 160),
    detail: input.detail.trim().slice(0, 4000),
    platform: input.platform,
    accountId: input.accountId,
    accountName: input.accountName?.trim() || null,
    campaignId: input.campaignId,
    campaignName: input.campaignName?.trim() || null,
    approvedBy: input.approvedBy.trim().slice(0, 120),
    approvalChannel: input.approvalChannel,
    approvalRef: input.approvalRef?.trim().slice(0, 160) || null,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    budget: input.budget,
    expectedChange: input.expectedChange,
    includesFullStop: input.includesFullStop,
    silenceAlerts: input.silenceAlerts && input.platform !== null,
    incidentId: input.incidentId,
    alertFingerprint: input.alertFingerprint,
    status: "VIGENTE",
    closedAt: null,
    closedBy: null,
    updates: [{ at: now, by, text: `${NOVEDAD_KIND_LABEL[input.kind]} registrada. Aprobó ${input.approvedBy.trim()}.` }],
  };
  await getRecordStore().set(`novedades/${id}`, n);
  changed();
  return n;
}

export async function getNovedad(id: string): Promise<Novedad | null> {
  if (!/^NOV-\d{4,}$/.test(id)) return null;
  const record = await getRecordStore().get<StoredNovedad>(`novedades/${id}`);
  return record ? publicNovedad(record) : null;
}

/** Seguimiento de una novedad: comentario, cambio de vigencia o cierre. Nunca se borra. */
export async function updateNovedad(id: string, patch: { text?: string; effectiveUntil?: string | null; status?: Novedad["status"] }, by: string): Promise<Novedad | null> {
  if (!await getNovedad(id)) return null;
  const now = new Date().toISOString();
  const operationId = randomUUID();
  const updated = await getRecordStore().update<StoredNovedad>(`novedades/${id}`, (current) => {
    if (!current || current.appliedOperations?.includes(operationId)) return current;
    const n: StoredNovedad = { ...current, updates: [...current.updates] };
    const notes: string[] = [];
    if (patch.effectiveUntil !== undefined && patch.effectiveUntil !== n.effectiveUntil) {
      n.effectiveUntil = patch.effectiveUntil;
      notes.push(`Vigencia: ${patch.effectiveUntil ? `hasta el ${patch.effectiveUntil}` : "todo el mes"}.`);
    }
    if (patch.status && patch.status !== n.status) {
      n.status = patch.status;
      if (patch.status === "CERRADA") {
        n.closedAt = now;
        n.closedBy = by;
        notes.push("Cerrada: el monitoreo ya no la toma en cuenta.");
      } else {
        n.closedAt = null;
        n.closedBy = null;
        notes.push("Reabierta.");
      }
    }
    const text = [patch.text?.trim().slice(0, 2000), ...notes].filter(Boolean).join(" ");
    if (!text) return n;
    n.updates.push({ at: now, by, text });
    n.appliedOperations = [...(current.appliedOperations ?? []), operationId].slice(-50);
    return n;
  });
  if (updated?.appliedOperations?.includes(operationId)) changed();
  return updated ? publicNovedad(updated) : null;
}

export async function listNovedades(brand: BrandId): Promise<Novedad[]> {
  return cached(`novedades:${brand}`, LIST_TTL, async () => {
    const store = getRecordStore();
    const keys = (await store.list("novedades/")).filter((k) => /^novedades\/NOV-\d+$/.test(k));
    const rows = await mapLimit(keys, 16, (k) => store.get<StoredNovedad>(k));
    return rows
      .filter((n): n is StoredNovedad => n !== null && (n.brand ?? DEFAULT_BRAND) === brand)
      .map(publicNovedad)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  });
}

// ─── Arranque de mes ─────────────────────────────────────────────────────────

const kickoffKey = (brand: BrandId, month: string) => `kickoff/${brand}/${month}`;

interface StoredMonthKickoff extends MonthKickoff {
  /** Short-lived replay receipts for confirmed detections, never public. */
  startedOperations?: Array<{ id: string; items: KickoffItem[] }>;
}

type KickoffIdentity = Pick<KickoffItem, "name" | "platform" | "accountName" | "campaignId">;
function sameKickoffIdentity(item: KickoffItem, expected: KickoffIdentity): boolean {
  return item.name === expected.name && item.platform === expected.platform
    && item.accountName === expected.accountName && item.campaignId === expected.campaignId;
}

function publicKickoff(k: StoredMonthKickoff): MonthKickoff {
  const result = { ...k, items: k.items.map(item => ({ ...item })), budgets: k.budgets.map(budget => ({ ...budget })) };
  delete result.startedOperations;
  return result;
}

export async function getKickoff(brand: BrandId, month: string): Promise<MonthKickoff | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return cached(`kickoff:${brand}:${month}`, LIST_TTL, async () => {
    const k = await getRecordStore().get<StoredMonthKickoff>(kickoffKey(brand, month));
    return k ? publicKickoff(k) : null;
  });
}

export async function saveKickoff(k: MonthKickoff): Promise<MonthKickoff> {
  const updated = await getRecordStore().update<StoredMonthKickoff>(kickoffKey(k.brand, k.month), current => ({
    ...k,
    // Confirmations replace the editable plan; detections and the first confirmation
    // come from the current document, never an earlier cached snapshot.
    confirmedAt: current?.confirmedAt ?? k.confirmedAt,
    confirmedBy: current?.confirmedBy ?? k.confirmedBy,
    budgets: k.budgets.map(budget => ({ ...budget })),
    items: k.items.map(item => ({ ...item, startedAt: item.startedAt ?? current?.items.find(previous => previous.key === item.key)?.startedAt ?? null })),
    ...(current?.startedOperations ? { startedOperations: current.startedOperations } : {}),
  }));
  if (!updated) throw new RecordStoreError();
  changed();
  return publicKickoff(updated);
}

/** Only fill the still-unlinked campaign IDs; never save an older budget/plan snapshot. */
export async function linkKickoffCampaigns(brand: BrandId, month: string, links: Array<{ key: string; campaignId: string; expected: KickoffIdentity }>, by: string): Promise<MonthKickoff | null> {
  const now = new Date().toISOString();
  const ids = new Map(links.map(link => [link.key, { campaignId: link.campaignId, expected: { ...link.expected } }]));
  const updated = await getRecordStore().update<StoredMonthKickoff>(kickoffKey(brand, month), current => {
    if (!current) return null;
    const items = current.items.map(item => {
      const link = ids.get(item.key);
      return item.state === "PENDING" && !item.startedAt && !item.campaignId && link && sameKickoffIdentity(item, link.expected)
        ? { ...item, campaignId: link.campaignId } : item;
    });
    if (items.every((item, index) => item === current.items[index])) return current;
    return { ...current, items, updatedAt: now, updatedBy: by };
  });
  if (updated) changed();
  return updated ? publicKickoff(updated) : null;
}

/** Marca como iniciadas las campañas pendientes que ya gastan (se detecta solo, una vez). */
export async function markKickoffStarted(brand: BrandId, month: string, started: Array<{ key: string; at: string; campaignId?: string; expected?: KickoffIdentity }>, by: string): Promise<KickoffItem[]> {
  if (!started.length) return [];
  const operationId = randomUUID();
  const now = new Date().toISOString();
  const starts = new Map<string, { at: string; campaignId?: string; expected?: KickoffIdentity }>();
  for (const item of started) if (!starts.has(item.key)) starts.set(item.key, { at: item.at, campaignId: item.campaignId, expected: item.expected ? { ...item.expected } : undefined });
  const updated = await getRecordStore().update<StoredMonthKickoff>(kickoffKey(brand, month), current => {
    if (!current || current.startedOperations?.some(operation => operation.id === operationId)) return current;
    const items = current.items.map(item => {
      const start = starts.get(item.key);
      return item.state === "PENDING" && !item.startedAt && start && (!start.campaignId || start.campaignId === item.campaignId)
        && (!start.expected || sameKickoffIdentity(item, start.expected))
        ? { ...item, startedAt: start.at } : item;
    });
    const detected = items.filter((item, index) => item !== current.items[index]);
    if (!detected.length) return current;
    return { ...current, items, updatedAt: now, updatedBy: by, startedOperations: [...(current.startedOperations ?? []), { id: operationId, items: detected }].slice(-50) };
  });
  const detected = updated?.startedOperations?.find(operation => operation.id === operationId)?.items;
  if (!detected?.length) return [];
  changed();
  return detected.map(item => ({ ...item }));
}
