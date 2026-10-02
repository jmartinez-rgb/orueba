import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedback, getFeedback, listFeedback, updateFeedback } from "@/lib/records/feedback";
import { createTicket, getTicket, listTickets, updateTicket } from "@/lib/records/tickets";
import { createNovedad, getNovedad, listNovedades, updateNovedad } from "@/lib/records/novedades";
import { getRecordStore, resetRecordStore } from "@/lib/records/store";
import { invalidate } from "@/lib/data/cache";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "record-followup-")); resetRecordStore(); invalidate(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetRecordStore(); invalidate(); await rm(directory, { recursive: true, force: true }); });

const records = [
  {
    name: "feedback", prefix: "feedback/",
    create: () => createFeedback({ kind: "BUG", title: "Fixture", description: "Fixture", page: null, impact: "MEDIO" }, { id: "fixture", name: "Fixture", role: "operativo" }, null),
    update: (id: string, label: string) => updateFeedback(id, { adminNote: label }, label), get: getFeedback, list: listFeedback,
  },
  {
    name: "ticket", prefix: "tickets/",
    create: () => createTicket({ title: "Fixture", description: "Fixture", severity: "ATTENTION", category: "DATOS", platform: null, accountName: null, incidentIds: [], reportedTo: "", channel: "OTRO", externalRef: null, owner: null }, "Fixture"),
    update: (id: string, label: string) => updateTicket(id, { text: label }, label), get: getTicket, list: listTickets,
  },
  {
    name: "novedad", prefix: "novedades/",
    create: () => createNovedad({ kind: "OTRO", title: "Fixture", detail: "Fixture", platform: null, accountId: null, accountName: null, campaignId: null, campaignName: null, approvedBy: "Fixture", approvalChannel: "OTRO", approvalRef: null, effectiveFrom: "2026-10-01", effectiveUntil: null, budget: null, expectedChange: null, includesFullStop: false, silenceAlerts: false, incidentId: null, alertFingerprint: null }, "Fixture"),
    update: (id: string, label: string) => updateNovedad(id, { text: label }, label), get: getNovedad, list: () => listNovedades("izzi"),
  },
];

describe.each(["memory", "file"] as const)("concurrent follow-ups with %s records", (backend) => {
  beforeEach(() => { vi.stubEnv("RECORDS_BACKEND", backend); vi.stubEnv("RECORDS_DIR", directory); resetRecordStore(); });

  it.each(records)("keeps all concurrent $name follow-ups and their authors", async ({ create, update, get }) => {
    const record = await create();
    await Promise.all(Array.from({ length: 12 }, (_, index) => update(record.id, `Follow-up ${index}`)));
    const stored = await get(record.id);
    expect(stored?.updates).toHaveLength(13);
    expect(new Set(stored?.updates.slice(1).map(item => item.by)).size).toBe(12);
  });

  it.each(records)("does not append a $name follow-up twice when its confirmed write is replayed", async ({ create, update, get }) => {
    const record = await create(), store = getRecordStore();
    const original = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementationOnce(async (key, transform) => {
      await original(key, transform);
      return original(key, transform);
    });
    await update(record.id, "Saved once");
    expect((await get(record.id))?.updates).toHaveLength(2);
  });

  it.each(records)("preserves a newer $name follow-up when an earlier applied callback replays", async ({ create, update, get }) => {
    const record = await create(), store = getRecordStore();
    const original = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementationOnce(async (key, transform) => {
      await original(key, transform);
      await update(record.id, "Newer follow-up");
      return original(key, transform);
    });
    await update(record.id, "Earlier follow-up");
    const stored = await get(record.id);
    expect(stored?.updates.map(item => item.by)).toEqual(["Fixture", "Earlier follow-up", "Newer follow-up"]);
    if (stored && "adminNote" in stored) expect(stored.adminNote).toBe("Newer follow-up");
  });

  it.each(records)("keeps private $name replay receipts out of all public reads", async ({ create, update, get, list }) => {
    const record = await create();
    const updated = await update(record.id, "Follow-up");
    for (const value of [updated, await get(record.id), await list()]) expect(JSON.stringify(value)).not.toContain("appliedOperations");
  });

  it.each(records)("bounds private $name receipts while preserving its complete follow-up history", async ({ create, update, get, prefix }) => {
    const record = await create();
    for (let index = 0; index < 55; index++) await update(record.id, `Follow-up ${index}`);
    const stored = await getRecordStore().get<{ appliedOperations: string[] }>(`${prefix}${record.id}`);
    expect(stored?.appliedOperations).toHaveLength(50);
    expect(new Set(stored?.appliedOperations).size).toBe(50);
    expect((await get(record.id))?.updates).toHaveLength(56);
  });

  it("preserves independent ticket field edits made concurrently", async () => {
    const record = await records[1].create();
    await Promise.all([updateTicket(record.id, { owner: "Assigned fixture" }, "Owner actor"), updateTicket(record.id, { externalRef: "CASE-FIXTURE" }, "Reference actor")]);
    expect(await getTicket(record.id)).toMatchObject({ owner: "Assigned fixture", externalRef: "CASE-FIXTURE" });
    expect((await getTicket(record.id))?.updates).toHaveLength(3);
  });

  it("preserves independent feedback status and note edits made concurrently", async () => {
    const record = await records[0].create();
    await Promise.all([updateFeedback(record.id, { status: "EN_REVISION" }, "Status actor"), updateFeedback(record.id, { adminNote: "Saved note" }, "Note actor")]);
    expect(await getFeedback(record.id)).toMatchObject({ status: "EN_REVISION", adminNote: "Saved note" });
    expect((await getFeedback(record.id))?.updates).toHaveLength(3);
  });

  it("preserves independent novedad status and validity edits made concurrently", async () => {
    const record = await records[2].create();
    await Promise.all([updateNovedad(record.id, { status: "CERRADA" }, "Status actor"), updateNovedad(record.id, { effectiveUntil: "2026-10-07" }, "Validity actor")]);
    expect(await getNovedad(record.id)).toMatchObject({ status: "CERRADA", closedBy: "Status actor", effectiveUntil: "2026-10-07" });
    expect((await getNovedad(record.id))?.updates).toHaveLength(3);
  });
});
