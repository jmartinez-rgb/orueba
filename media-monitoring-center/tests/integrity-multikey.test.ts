import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate } from "@/lib/data/cache";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { getKickoff, listNovedades, saveKickoff, type MonthKickoff } from "@/lib/records/novedades";
import { createTicket, listTickets } from "@/lib/records/tickets";
import { getRecordStore, resetRecordStore, RecordStoreError, type RecordStore } from "@/lib/records/store";
import { confirmKickoff, kickoffStatus } from "@/lib/services/kickoff";
import type { AppContext } from "@/lib/services/context";
import type { Snapshot } from "@/lib/services/snapshot";

// Escrituras de varias llaves sin transacción: se reproduce la caída entre ambas y se fija el
// estado resultante (sin IDs reutilizados, sin registros corruptos; huecos y faltantes documentados).
const MONTH = "2026-10";
const plan = (): MonthKickoff => ({
  month: MONTH, brand: "izzi", confirmedAt: "2026-10-01T15:00:00.000Z", confirmedBy: "Admin ficticio",
  budgets: [{ platform: "meta", accountId: null, accountName: null, amount: 1000 }],
  items: [{ key: "pend:fixture", platform: "meta", accountName: "Cuenta ficticia", campaignId: "c-1", name: "Lanzamiento", state: "PENDING", expectedStart: "2026-10-02", note: null, startedAt: null }],
  updatedAt: "2026-10-01T15:00:00.000Z", updatedBy: "Admin ficticio",
});
const context = (kickoff: MonthKickoff | null) => ({
  brand: "izzi", brandPlatforms: ["meta"], kickoff,
  settings: { ...DEFAULT_SETTINGS, timezone: "America/Mexico_City", monitoredPlatforms: ["meta"] },
  source: { now: () => new Date("2026-10-02T15:00:00.000Z"), getBudgets: async () => [] },
  store: { getOverrides: async () => ({ budgets: [] }) },
}) as unknown as AppContext;
const snapshot = () => ({
  catalog: { campaigns: [{ id: "c-1", name: "Lanzamiento", platform: "meta" }] },
  run: { businessDate: "2026-10-02", entities: [{ level: "campaign", campaignId: "c-1", cumulative: { spend: { current: 100 } } }] },
}) as unknown as Snapshot;
/** Simula la caída del proceso justo al crear el registro (después de reservar su número). */
function crashOnFirstSet(prefix: string) {
  const store = getRecordStore(), original = store.set.bind(store);
  let crashed = false;
  vi.spyOn(store, "set").mockImplementation((async (key, value) => {
    if (!crashed && key.startsWith(prefix)) { crashed = true; throw new RecordStoreError(); }
    return original(key, value);
  }) as RecordStore["set"]);
}
const ticketInput: Parameters<typeof createTicket>[0] = { title: "Revisión ficticia", description: "Detalle", severity: "ALERT", category: "OTRO", platform: null, accountName: null, incidentIds: [], reportedTo: "", channel: "OTRO", externalRef: null, owner: null };

beforeEach(() => { vi.restoreAllMocks(); vi.stubEnv("RECORDS_BACKEND", "memory"); resetRecordStore(); invalidate(); });

describe("Integridad multiclave ante caídas", () => {
  it("contador + ticket: la caída deja un hueco de numeración, nunca un ID reutilizado", async () => {
    crashOnFirstSet("tickets/");
    await expect(createTicket(ticketInput, "Usuario ficticio")).rejects.toBeInstanceOf(RecordStoreError);
    expect(await getRecordStore().get("counters/tickets")).toEqual({ n: 1 });
    const second = await createTicket(ticketInput, "Usuario ficticio");
    expect(second.id).toBe("TKT-0002");
    expect((await listTickets()).map(t => t.id)).toEqual(["TKT-0002"]);
  });

  it("arranque: si falla la novedad, el arranque queda guardado y el reintento registra «actualizado»", async () => {
    crashOnFirstSet("novedades/");
    const input = { month: MONTH, budgets: plan().budgets, items: plan().items };
    await expect(confirmKickoff(context(null), input, "Admin ficticio")).rejects.toBeInstanceOf(RecordStoreError);
    expect(await getKickoff("izzi", MONTH)).not.toBeNull();
    expect(await listNovedades("izzi")).toHaveLength(0);
    await confirmKickoff(context(null), input, "Admin ficticio");
    const titles = (await listNovedades("izzi")).map(n => n.title);
    expect(titles).toEqual([`Arranque actualizado: ${MONTH}`]);
  });

  it("inicio detectado: si falla la novedad, el inicio queda marcado y la novedad no se reintenta", async () => {
    await saveKickoff(plan());
    crashOnFirstSet("novedades/");
    const first = await kickoffStatus(context(await getKickoff("izzi", MONTH)), snapshot());
    expect(first.justStarted).toEqual(["Lanzamiento"]);
    expect((await getKickoff("izzi", MONTH))!.items[0].startedAt).not.toBeNull();
    const again = await kickoffStatus(context(await getKickoff("izzi", MONTH)), snapshot());
    expect(again.justStarted).toEqual([]);
    // Estado documentado: la novedad ACTIVACION se pierde (solo queda el aviso en el log).
    expect((await listNovedades("izzi")).filter(n => n.kind === "ACTIVACION")).toHaveLength(0);
  });
});
