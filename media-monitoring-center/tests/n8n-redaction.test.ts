import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { triggerWebhook, type WebhookKind } from "@/lib/n8n/client";
import { POST as refresh } from "@/app/api/monitoring/run/route";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), context: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/services/context", () => ({ getAppContext: mocks.context }));
vi.mock("@/lib/services/evaluate", () => ({ evaluateAllBrands: vi.fn() }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));

const secrets = ["fixture-signed-secret", "fixture-token", "fixture-auth", "fixture-client-secret"];
const diagnostic = 'HTTP 403 ACCESS_REQUIRED https://fixture.invalid/private/report.csv?sig=fixture-signed-secret&access_token=fixture-token\nAuthorization: Bearer fixture-auth\n{"client_secret":"fixture-client-secret"}';
function expectSafe(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of secrets) expect(text).not.toContain(secret);
  expect(text).not.toContain("private/report.csv");
  expect(text).not.toContain("sig=");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LOG_LEVEL", "error");
  vi.stubEnv("DATA_SOURCE", "unified");
  vi.stubEnv("N8N_WEBHOOK_SECRET", "");
  vi.stubEnv("N8N_BASE_URL", "");
  vi.stubEnv("N8N_MONITORING_WEBHOOK", "https://fixture.invalid/monitoring");
  vi.stubEnv("N8N_ALERT_WEBHOOK", "https://fixture.invalid/alert");
  vi.stubEnv("N8N_MANUAL_SYNC_WEBHOOK", "https://fixture.invalid/manual");
  resetEnvCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(diagnostic); }));
  mocks.context.mockResolvedValue({ mode: "unified", settings: structuredClone(DEFAULT_SETTINGS) });
  mocks.permission.mockImplementation(async permission => permission === "monitoring:trigger" ? { user: { name: "Fixture", id: "fixture" }, role: "viewer" } : null);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

describe("fallos de n8n sin credenciales en la respuesta", () => {
  it.each<WebhookKind>(["alert", "monitoring", "manualSync"])("%s devuelve únicamente diagnóstico saneado", async kind => {
    const result = await triggerWebhook(kind, { fixture: true }, { retries: 0 });
    expect(result).toMatchObject({ ok: false, mode: "live", attempts: 1, response: null });
    expect(result.message).toContain("HTTP 403 ACCESS_REQUIRED");
    expect(result.message).toContain("fixture.invalid");
    expectSafe(result);
    expectSafe(vi.mocked(console.error).mock.calls);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("Actualizar ahora no entrega URL firmada ni tokens a una sesión sin technical:view", async () => {
    const response = await refresh();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, webhook: { mode: "live", ok: false, status: null } });
    expect(body).not.toHaveProperty("technical");
    expect(body.message).toContain("HTTP 403 ACCESS_REQUIRED");
    expectSafe(body);
    expectSafe(vi.mocked(console.error).mock.calls);
    expect(mocks.permission).toHaveBeenCalledWith("monitoring:trigger");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
