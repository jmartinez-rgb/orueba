import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { triggerWebhook, type WebhookKind } from "@/lib/n8n/client";

beforeEach(() => {
  vi.stubEnv("LOG_LEVEL", "error");
  vi.stubEnv("DATA_SOURCE", "mock");
  vi.stubEnv("N8N_WEBHOOK_SECRET", "");
  vi.stubEnv("N8N_BASE_URL", "");
  vi.stubEnv("N8N_MONITORING_WEBHOOK", "https://fixture.invalid/monitoring");
  vi.stubEnv("N8N_ALERT_WEBHOOK", "https://fixture.invalid/alert");
  vi.stubEnv("N8N_MANUAL_SYNC_WEBHOOK", "https://fixture.invalid/manual");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("webhooks n8n en modo simulado", () => {
  it.each<WebhookKind>(["alert", "monitoring", "manualSync"])("%s nunca sale a red aunque tenga URL configurada", async kind => {
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", request);
    const result = await triggerWebhook(kind, { fixture: true });
    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, mode: "simulated", status: null, attempts: 0, response: null });
  });

  it("también simula cuando Sheets cae al modo mock por falta de configuración", async () => {
    vi.stubEnv("DATA_SOURCE", "sheets");
    vi.stubEnv("SHEETS_SPREADSHEET_ID", "");
    resetEnvCache();
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", request);
    expect(await triggerWebhook("alert", { fixture: true })).toMatchObject({ ok: true, mode: "simulated", attempts: 0 });
    expect(request).not.toHaveBeenCalled();
  });

  it("conserva el despacho real cuando la fuente efectiva es unified", async () => {
    vi.stubEnv("DATA_SOURCE", "unified");
    resetEnvCache();
    const request = vi.fn(async () => new Response('{"accepted":true}', { status: 202 }));
    vi.stubGlobal("fetch", request);
    expect(await triggerWebhook("alert", { fixture: true })).toMatchObject({ ok: true, mode: "live", status: 202, attempts: 1, response: { accepted: true } });
    expect(request).toHaveBeenCalledOnce();
  });

  it("una fuente real sin webhook sigue indicando que no está configurado", async () => {
    vi.stubEnv("DATA_SOURCE", "unified");
    vi.stubEnv("N8N_ALERT_WEBHOOK", "");
    resetEnvCache();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(await triggerWebhook("alert", { fixture: true })).toMatchObject({ ok: false, mode: "not_configured", status: null, attempts: 0 });
    expect(request).not.toHaveBeenCalled();
  });
});
