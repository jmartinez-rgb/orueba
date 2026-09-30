import "server-only";
import { DEFAULT_BRAND, type BrandId } from "@/lib/brands";
import { cached, invalidate } from "@/lib/data/cache";
import { getRecordStore, mapLimit } from "./store";
import { NOVEDAD_KIND_LABEL, type KickoffItem, type MonthKickoff, type NewNovedad, type Novedad } from "./novedad-model";

export * from "./novedad-model";

/**
 * Novedades del mes (ajustes aprobados) y arranque de mes. Registro interno: la app no cambia
 * nada en las plataformas; solo documenta lo aprobado para que el monitoreo lo tome en cuenta.
 */

const LIST_TTL = 15 * 1000;

async function nextId(): Promise<string> {
  const store = getRecordStore();
  const cur = (await store.get<{ n: number }>("counters/novedades"))?.n ?? 0;
  let n = cur + 1;
  while (await store.get(`novedades/NOV-${String(n).padStart(4, "0")}`)) n++;
  await store.set("counters/novedades", { n });
  return `NOV-${String(n).padStart(4, "0")}`;
}

function changed() {
  invalidate("novedades:");
  invalidate("kickoff:");
  // Lo que el monitoreo toma en cuenta cambió: la evaluación en vivo se recalcula.
  invalidate("live:");
  invalidate("replay:");
  invalidate("brandstatus:");
}

export async function createNovedad(input: NewNovedad, by: string, brand: BrandId = DEFAULT_BRAND): Promise<Novedad> {
  const id = await nextId();
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
  return getRecordStore().get<Novedad>(`novedades/${id}`);
}

/** Seguimiento de una novedad: comentario, cambio de vigencia o cierre. Nunca se borra. */
export async function updateNovedad(id: string, patch: { text?: string; effectiveUntil?: string | null; status?: Novedad["status"] }, by: string): Promise<Novedad | null> {
  const n = await getNovedad(id);
  if (!n) return null;
  const now = new Date().toISOString();
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
  await getRecordStore().set(`novedades/${id}`, n);
  changed();
  return n;
}

export async function listNovedades(brand: BrandId): Promise<Novedad[]> {
  return cached(`novedades:${brand}`, LIST_TTL, async () => {
    const store = getRecordStore();
    const keys = (await store.list("novedades/")).filter((k) => /^novedades\/NOV-\d+$/.test(k));
    const rows = await mapLimit(keys, 16, (k) => store.get<Novedad>(k));
    return rows
      .filter((n): n is Novedad => n !== null && (n.brand ?? DEFAULT_BRAND) === brand)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  });
}

// ─── Arranque de mes ─────────────────────────────────────────────────────────

const kickoffKey = (brand: BrandId, month: string) => `kickoff/${brand}/${month}`;

export async function getKickoff(brand: BrandId, month: string): Promise<MonthKickoff | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return cached(`kickoff:${brand}:${month}`, LIST_TTL, () => getRecordStore().get<MonthKickoff>(kickoffKey(brand, month)));
}

export async function saveKickoff(k: MonthKickoff): Promise<void> {
  await getRecordStore().set(kickoffKey(k.brand, k.month), k);
  changed();
}

/** Marca como iniciadas las campañas pendientes que ya gastan (se detecta solo, una vez). */
export async function markKickoffStarted(brand: BrandId, month: string, started: Array<{ key: string; at: string }>, by: string): Promise<KickoffItem[]> {
  const k = await getRecordStore().get<MonthKickoff>(kickoffKey(brand, month));
  if (!k) return [];
  const done: KickoffItem[] = [];
  for (const s of started) {
    const it = k.items.find((i) => i.key === s.key && i.state === "PENDING" && !i.startedAt);
    if (!it) continue;
    it.startedAt = s.at;
    done.push(it);
  }
  if (!done.length) return [];
  k.updatedAt = new Date().toISOString();
  k.updatedBy = by;
  await saveKickoff(k);
  return done;
}
