import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIntegrations } from "@/lib/services/integrations";
import { GET } from "@/app/api/integrations/route";
import type { Snapshot } from "@/lib/services/snapshot";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), permission: vi.fn(), snapshot: vi.fn(), event: vi.fn(),
  env: { requestedDataSource: "sheets", sheets: { credentials: false, spreadsheetId: "fixture-sheet" }, bigquery: { configured: false, location: "US", maxBytesBilled: 0 }, n8n: { configured: false }, whatsapp: { enabled: false, templateLanguage: "es" } },
}));
vi.mock("@/lib/config/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@/lib/auth/session", () => ({ requireAuth: mocks.auth, requirePermission: mocks.permission, hasPermission: (session: { permissions: string[] }, permission: string) => session.permissions.includes(permission) }));
vi.mock("@/lib/services/snapshot", () => ({ getSnapshot: mocks.snapshot }));
vi.mock("@/lib/logging/logger", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/logging/logger")>(), lastIntegrationEvent: mocks.event }));

const secrets = ["fixture-signed-secret", "fixture-token", "fixture-auth", "fixture-client-secret"];
const error = 'HTTP 403 ACCESS_REQUIRED https://fixture.invalid/private/report.csv?sig=fixture-signed-secret&access_token=fixture-token\nAuthorization: Bearer fixture-auth\n{"client_secret":"fixture-client-secret"}';
function snapshot(technical = false): Snapshot {
  return {
    meta: { mode: "sheets", permissions: technical ? ["technical:view"] : ["internal:view"], timezone: "America/Mexico_City", mappingErrors: [], sheets: { errors: [error], title: "Fixture Sheet", tabs: [] } },
    run: { platforms: [] }, runs: [], state: { notifications: [] },
  } as unknown as Snapshot;
}
function safe(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of secrets) expect(text).not.toContain(secret);
  expect(text).not.toContain("private/report.csv"); expect(text).not.toContain("sig=");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.requestedDataSource = "sheets"; mocks.env.bigquery.configured = false; mocks.env.n8n.configured = false;
  mocks.event.mockReturnValue(null);
  mocks.auth.mockResolvedValue({ authenticated: true, role: "viewer", permissions: ["internal:view", "client:view"], brands: ["izzi"] });
  mocks.permission.mockResolvedValue(null); mocks.snapshot.mockResolvedValue(snapshot());
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Tests must not use network"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Integraciones: diagnóstico según permisos y sin credenciales", () => {
  it("el lector recibe estado de Sheets y un mensaje general, sin errores técnicos", () => {
    const items = getIntegrations(snapshot());
    expect(items.find(item => item.id === "sheets")?.status).toBe("DEGRADED");
    expect(JSON.stringify(items)).not.toContain("ACCESS_REQUIRED");
    safe(items); expect(fetch).not.toHaveBeenCalled();
  });

  it("la API verifica el permiso de su sesión aunque una proyección incompatible contenga technical:view", async () => {
    mocks.snapshot.mockResolvedValue(snapshot(true));
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("ACCESS_REQUIRED");
    safe(body); expect(fetch).not.toHaveBeenCalled();
  });

  it("la sesión técnica conserva códigos y host, nunca URL firmada, tokens ni cuerpos OAuth", async () => {
    mocks.auth.mockResolvedValue({ authenticated: true, role: "auditor", permissions: ["internal:view", "technical:view"] });
    // El permiso se toma de la sesión API, sin depender de otra proyección.
    const body = await (await GET()).json();
    expect(JSON.stringify(body)).toContain("ACCESS_REQUIRED");
    expect(JSON.stringify(body)).toContain("fixture.invalid");
    safe(body);
    safe(getIntegrations(snapshot(true)));
  });

  it.each([false, true])("el fallback a mock no filtra errores de mapeo Sheets (technical=%s)", technical => {
    const snap = snapshot(technical); snap.meta.mode = "mock";
    const items = getIntegrations(snap);
    safe(items);
    expect(JSON.stringify(items).includes("ACCESS_REQUIRED")).toBe(technical);
    expect(items.find(item => item.id === "sheets")?.status).toBe("ERROR");
  });

  it.each([false, true])("el mapeo BigQuery inválido se oculta o sanea (technical=%s)", technical => {
    mocks.env.requestedDataSource = "bigquery"; mocks.env.bigquery.configured = true;
    const snap = snapshot(technical); snap.meta.mode = "mock"; snap.meta.mappingErrors = [error];
    const items = getIntegrations(snap);
    safe(items);
    expect(JSON.stringify(items).includes("ACCESS_REQUIRED")).toBe(technical);
    expect(items.find(item => item.id === "bigquery")?.status).toBe("ERROR");
  });

  it.each([false, true])("los errores heredados del buffer tampoco llegan crudos al usuario (technical=%s)", technical => {
    mocks.env.requestedDataSource = "bigquery"; mocks.env.n8n.configured = true;
    mocks.event.mockReturnValue({ at: "2026-10-02T12:00:00Z", action: "fixture", ok: false, detail: error });
    const snap = snapshot(technical); snap.meta.mode = "bigquery"; snap.meta.sheets = null;
    const items = getIntegrations(snap);
    safe(items);
    expect(JSON.stringify(items).includes("ACCESS_REQUIRED")).toBe(technical);
  });
});
