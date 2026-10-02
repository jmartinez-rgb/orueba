import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordsStateStore } from "@/lib/state/records-store";
import { resetRecordStore } from "@/lib/records/store";
import { applyOverrides } from "@/lib/services/snapshot";
import { emptyAlertState, type Incident } from "@/lib/alerts/types";

let directory: string;
afterEach(async () => { if (directory) await rm(directory, { force: true, recursive: true }); vi.unstubAllEnvs(); resetRecordStore(); });
it("asignación, seguimiento y cierre sobreviven a otro almacén y conservan el historial", async () => {
  directory = await mkdtemp(join(tmpdir(), "incident-owner-"));
  vi.stubEnv("RECORDS_BACKEND", "file"); vi.stubEnv("RECORDS_DIR", directory); resetRecordStore();
  const store = new RecordsStateStore();
  await store.updateIncident("INC-0001", { owner: "Ana", ownerId: "ana" }, "Admin");
  await store.updateIncident("INC-0001", { status: "INVESTIGATING", note: "Revisando causa" }, "Ana");
  await store.updateIncident("INC-0001", { owner: "Bea", ownerId: "bea" }, "Admin");
  await store.updateIncident("INC-0001", { status: "RESOLVED", note: "Recuperación validada" }, "Bea");
  resetRecordStore();
  const reloaded = new RecordsStateStore();
  const state = emptyAlertState();
  state.incidents = [{ id: "INC-0001", owner: null, resolvedAt: null, status: "OPEN", notes: [], timeline: [], severity: "ALERT", currentDeviation: -0.3,
    fingerprint: "platform:tiktok#delivery", alertId: "ALT-0001", type: "DELIVERY_ISSUE", title: "Entrega", metric: "spend", startedAt: new Date().toISOString(), lastUpdateAt: new Date().toISOString(), maxSeverity: "ALERT", maxDeviation: -0.3, evidence: [], childAlertIds: [], expectedSpendShare: null, level: "platform", platform: "tiktok", accountId: null, accountName: null, campaignId: null, campaignName: null,
    notification: { count: 0, lastNotifiedAt: null, lastSeverity: null, lastDeviation: null, durationReminderSent: false },
  } satisfies Incident];
  const incident = applyOverrides(state, await reloaded.getOverrides()).incidents[0];
  expect(incident).toMatchObject({ ownerId: "bea", owner: "Bea", status: "RESOLVED" });
  expect(incident.resolvedAt).toBeTruthy();
  expect(incident.actions?.filter(a => a.kind === "OWNER").map(a => [a.valueId, a.by])).toEqual([["ana", "Admin"], ["bea", "Admin"]]);
  expect(incident.notes.map(n => n.author)).toEqual(["Ana", "Bea"]);
  applyOverrides(state, await reloaded.getOverrides());
  expect(incident.notes).toHaveLength(2);
  expect(incident.actions).toHaveLength(6);
  await Promise.all([store.updateIncident("INC-0002", { owner: "Ana", ownerId: "ana" }, "Admin"), reloaded.updateIncident("INC-0003", { owner: "Bea", ownerId: "bea" }, "Admin")]);
  expect(Object.keys((await reloaded.getOverrides()).incidents)).toEqual(["INC-0001", "INC-0002", "INC-0003"]);
  expect(await new RecordsStateStore("state/sky/").getOverrides()).toMatchObject({ incidents: {} });
});
