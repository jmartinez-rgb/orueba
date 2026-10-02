import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { friendlyError, logger, recentIntegrationEvents, recordIntegrationEvent } from "@/lib/logging/logger";
import { serverError } from "@/lib/services/http";
import { ErrorPanel } from "@/components/monitoring/error-panel";

const mocks = vi.hoisted(() => ({ permission: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission }));

const sensitive = ["fixture-signed-secret", "fixture-token", "fixture-password", "fixture-auth", "fixture-client-secret"];
const diagnostic = 'HTTP 403 ACCESS_REQUIRED https://fixture-user:fixture-password@fixture.invalid/report.csv?sig=fixture-signed-secret&access_token=fixture-token\nAuthorization: Bearer fixture-auth\n{"client_secret":"fixture-client-secret","refresh_token":"fixture-token"}';
const sanitized = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const secret of sensitive) expect(text).not.toContain(secret);
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LOG_LEVEL", "info");
  mocks.permission.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("diagnósticos sin credenciales", () => {
  it("sanea mensajes de Error, URLs firmadas y cuerpos OAuth conservando código y host", () => {
    const result = friendlyError("api", new Error(diagnostic));
    sanitized(result);
    expect(result.technical).toContain("HTTP 403 ACCESS_REQUIRED");
    expect(result.technical).toContain("fixture.invalid");
    expect(result.technical).not.toContain("report.csv");
    expect(result.technical).not.toContain("sig=");
  });

  it("sanea Error.message y strings anidados además de claves sensibles", () => {
    logger.error("fixture.redaction", { error: new Error(diagnostic), nested: { detail: diagnostic, access_token: "fixture-token" } });
    sanitized(vi.mocked(console.error).mock.calls);
  });

  it("el buffer de integraciones tampoco conserva URLs firmadas ni tokens", () => {
    recordIntegrationEvent({ target: "api", action: "fixture-redaction", ok: false, durationMs: 1, detail: diagnostic });
    sanitized(recentIntegrationEvents().filter(event => event.action === "fixture-redaction"));
    sanitized(vi.mocked(console.error).mock.calls);
  });

  it("un error HTTP no entrega detalle técnico sin technical:view", async () => {
    const response = await serverError("api", new Error(diagnostic), "fixture");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty("technical");
    expect(mocks.permission).toHaveBeenCalledWith("technical:view");
    sanitized(body);
    sanitized(vi.mocked(console.error).mock.calls);
  });

  it("una sesión autorizada recibe únicamente detalles saneados", async () => {
    mocks.permission.mockResolvedValue({ user: { id: "fixture-admin" } });
    const body = await (await serverError("api", new Error(diagnostic), "fixture")).json();
    expect(body.technical).toContain("ACCESS_REQUIRED");
    sanitized(body);
  });

  it("un fallo al comprobar permisos mantiene el detalle privado", async () => {
    mocks.permission.mockRejectedValue(new Error("fixture permission unavailable"));
    const body = await (await serverError("api", new Error(diagnostic), "fixture")).json();
    expect(body).not.toHaveProperty("technical");
    sanitized(body);
  });

  it("el panel servidor no manda detalles al componente cliente sin permiso", async () => {
    const panel = await ErrorPanel({ message: "No pudimos cargar los datos.", technical: diagnostic });
    expect(panel.props.children.props.technical).toBeUndefined();
    sanitized(panel.props.children.props);
  });

  it("el panel servidor autorizado conserva el detalle útil saneado", async () => {
    mocks.permission.mockResolvedValue({ user: { id: "fixture-admin" } });
    const panel = await ErrorPanel({ message: "No pudimos cargar los datos.", technical: diagnostic });
    expect(panel.props.children.props.technical).toContain("ACCESS_REQUIRED");
    sanitized(panel.props.children.props);
  });
});
