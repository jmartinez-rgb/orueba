import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { resetEnvCache } from "@/lib/config/env";
import { evaluateNow } from "@/lib/services/evaluate";
import { POST as refresh } from "@/app/api/monitoring/run/route";
import type { AppContext } from "@/lib/services/context";
import { emptyAlertState, type NotificationRecord } from "@/lib/alerts/types";
import { BRANDS } from "@/lib/brands";

const mocks = vi.hoisted(() => ({ run: vi.fn(), reconcile: vi.fn(), dispatch: vi.fn(), base: vi.fn(), summary: vi.fn(), input: vi.fn(), context: vi.fn(), permission: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/monitoring/monitoring-engine", () => ({ runMonitoring: mocks.run }));
vi.mock("@/lib/alerts/incident-manager", () => ({ reconcile: mocks.reconcile }));
vi.mock("@/lib/alerts/dispatcher", () => ({ dispatchNotifications: mocks.dispatch }));
vi.mock("@/lib/services/snapshot", () => ({ baseAlertState: mocks.base, applyOverrides: (state: unknown) => state, summarizeRun: mocks.summary }));
vi.mock("@/lib/services/context", () => ({ monitoringInput: mocks.input, getAppContext: mocks.context }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));

const notification = { id: "fixture-notification", incidentId: "fixture-incident", kind: "OPENED", severity: "ALERT", platform: "meta", channel: "whatsapp" } as NotificationRecord;
let ctx: AppContext;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LOG_LEVEL", "error");
  // La fuente solicitada parece real; el contexto es la autoridad del fallback.
  vi.stubEnv("DATA_SOURCE", "unified");
  vi.stubEnv("N8N_BASE_URL", "");
  vi.stubEnv("N8N_WEBHOOK_SECRET", "");
  vi.stubEnv("N8N_MANUAL_SYNC_WEBHOOK", "https://fixture.invalid/manual");
  resetEnvCache();
  ctx = {
    mode: "mock", brand: "izzi", brandInfo: BRANDS.izzi,
    settings: structuredClone(DEFAULT_SETTINGS),
    source: { now: () => new Date("2026-10-02T13:00:00Z") },
    store: { loadAlertState: vi.fn(async () => emptyAlertState()), getOverrides: vi.fn(async () => ({ alerts: {}, incidents: {}, budgets: [] })), saveAlertState: vi.fn(), saveNotifications: vi.fn(), saveRun: vi.fn() },
  } as unknown as AppContext;
  mocks.run.mockResolvedValue({ businessDate: "2026-10-02", runAt: "2026-10-02T13:00:00Z", cutoffHour: 7, overall: "ALERT", anomalies: [] });
  mocks.base.mockResolvedValue({ state: emptyAlertState(), runs: [] });
  mocks.reconcile.mockReturnValue({ state: emptyAlertState(), notifications: [notification] });
  mocks.summary.mockReturnValue({ platforms: {}, anomalies: 0, openIncidents: 0 });
  mocks.context.mockResolvedValue(ctx);
  mocks.permission.mockResolvedValue({ user: { name: "Fixture", id: "fixture" }, role: "admin" });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

describe("evaluaciones simuladas sin efectos externos", () => {
  it("el contexto mock no despacha ni persiste aunque env pida una fuente real", async () => {
    const result = await evaluateNow(ctx, { dryRun: false, trigger: "manual" });
    expect(result).toMatchObject({ persisted: false, dryRun: true, notifications: [{ status: "SIMULATED" }] });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(ctx.store.saveAlertState).not.toHaveBeenCalled();
    expect(ctx.store.saveNotifications).not.toHaveBeenCalled();
    expect(ctx.store.saveRun).not.toHaveBeenCalled();
  });

  it("dryRun explícito conserva SKIPPED sin despacho ni persistencia", async () => {
    ctx.mode = "unified";
    const result = await evaluateNow(ctx, { dryRun: true, trigger: "manual" });
    expect(result).toMatchObject({ persisted: false, dryRun: true, notifications: [{ status: "SKIPPED" }] });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(ctx.store.saveAlertState).not.toHaveBeenCalled();
  });

  it("una evaluación real conserva despacho y guardado", async () => {
    ctx.mode = "unified";
    mocks.dispatch.mockResolvedValue([{ ...notification, status: "SENT" }]);
    expect(await evaluateNow(ctx, { dryRun: false, trigger: "manual" })).toMatchObject({ persisted: true, dryRun: false, notifications: [{ status: "SENT" }] });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(ctx.store.saveAlertState).toHaveBeenCalledOnce();
    expect(ctx.store.saveNotifications).toHaveBeenCalledOnce();
    expect(ctx.store.saveRun).toHaveBeenCalledOnce();
  });

  it("Actualizar ahora respeta el fallback efectivo y no dispara manualSync", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", request);
    const response = await refresh();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, webhook: { mode: "simulated", ok: true, status: null } });
    expect(request).not.toHaveBeenCalled();
  });

  it("Actualizar ahora no dispara n8n si no puede comprobar el contexto", async () => {
    mocks.context.mockRejectedValue(new Error("fixture context unavailable"));
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect((await refresh()).status).toBe(500);
    expect(request).not.toHaveBeenCalled();
  });

  it("Actualizar ahora real conserva el webhook configurado", async () => {
    ctx.mode = "unified";
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", request);
    expect(await (await refresh()).json()).toMatchObject({ ok: true, webhook: { mode: "live", ok: true, status: 200 } });
    expect(request).toHaveBeenCalledOnce();
  });
});
