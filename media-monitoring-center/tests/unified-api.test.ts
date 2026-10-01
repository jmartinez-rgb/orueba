import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { fetchUnifiedStatus, validUnifiedUrl } from "@/lib/integrations/unified-api";

const KEY = "llave-interna-0123456789abcdef";
const providers = {
  data: [
    {
      id: "google",
      enum: "GOOGLE",
      name: "Google Ads",
      implemented: true,
      status: { provider: "google", name: "Google Ads", state: "connected", configured: true, implemented: true, missing_config: [], last_successful_sync: "2026-10-01T10:00:00Z", last_error: null, latency_ms: 120, checked_at: "2026-10-01T10:00:00Z" },
    },
    {
      id: "x",
      enum: "X",
      name: "X Ads",
      implemented: true,
      status: { provider: "x", name: "X Ads", state: "not_configured", configured: false, implemented: true, missing_config: ["X_ADS_CONSUMER_KEY"], last_successful_sync: null, last_error: null, latency_ms: null, checked_at: "2026-10-01T10:00:00Z" },
    },
    {
      id: "spotify",
      enum: "SPOTIFY",
      name: "Spotify Ads",
      implemented: true,
      status: { provider: "spotify", name: "Spotify Ads", state: "access_required", configured: true, implemented: true, missing_config: [], last_successful_sync: null, last_error: { code: "ACCESS_REQUIRED", message: "Ads API requiere habilitación.", at: "2026-10-01T10:00:00Z" }, latency_ms: 80, checked_at: "2026-10-01T10:00:00Z" },
    },
  ],
  request_id: "r1",
};

function configure(url = "https://api.ejemplo.mx") {
  vi.stubEnv("UNIFIED_ADS_API_URL", url);
  vi.stubEnv("UNIFIED_ADS_API_KEY", KEY);
  resetEnvCache();
}
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("API unificada desde el monitoreo", () => {
  it("solo acepta HTTPS, salvo la API local en desarrollo, y nunca credenciales en la URL", () => {
    expect(validUnifiedUrl("https://api.ejemplo.mx")).not.toBeNull();
    expect(validUnifiedUrl("http://127.0.0.1:8080")).not.toBeNull();
    expect(validUnifiedUrl("http://api.ejemplo.mx")).toBeNull();
    expect(validUnifiedUrl("https://user:pass@api.ejemplo.mx")).toBeNull();
    expect(validUnifiedUrl("no-es-url")).toBeNull();
  });

  it("sin configuración no llama a la red", async () => {
    vi.stubEnv("UNIFIED_ADS_API_URL", "");
    resetEnvCache();
    const request = vi.fn();
    expect(await fetchUnifiedStatus(request as unknown as typeof fetch)).toMatchObject({ ok: false, configured: false });
    expect(request).not.toHaveBeenCalled();
  });

  it("lee el estado de cada plataforma con la llave en el encabezado y sin redirecciones", async () => {
    configure();
    const request = vi.fn(async () => Response.json(providers));
    const r = await fetchUnifiedStatus(request as unknown as typeof fetch);
    expect(r.ok && r.providers.map((p) => [p.id, p.status.state])).toEqual([
      ["google", "connected"],
      ["x", "not_configured"],
      ["spotify", "access_required"],
    ]);
    const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.ejemplo.mx/api/v1/providers");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(KEY);
    expect(init.redirect).toBe("error");
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it.each(["connected", "access_required", "permission_denied", "degraded", "error"])("preserva X como integración implementada con estado %s para el panel", async (state) => {
    configure();
    const payload = structuredClone(providers);
    payload.data[1]!.status.state = state;
    payload.data[1]!.status.configured = true;
    const result = await fetchUnifiedStatus(vi.fn(async () => Response.json(payload)) as unknown as typeof fetch);
    expect(result.ok && result.providers.find((p) => p.id === "x")).toMatchObject({ name: "X Ads", implemented: true, status: { state, configured: true } });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("llave rechazada, error HTTP, respuesta inesperada o caída se reportan sin tumbar el monitoreo", async () => {
    configure();
    const cases: Array<[() => Promise<Response>, string]> = [
      [async () => new Response("{}", { status: 401 }), "rechazó la llave"],
      [async () => new Response("{}", { status: 503 }), "HTTP 503"],
      [async () => Response.json({ data: [{ id: "x" }] }), "inesperada"],
      [async () => Promise.reject(new TypeError("fetch failed")), "No se pudo conectar"],
    ];
    for (const [impl, text] of cases) {
      const r = await fetchUnifiedStatus(vi.fn(impl) as unknown as typeof fetch);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toContain(text);
    }
  });
});
