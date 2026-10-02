import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/domain/route";
import { googleDomainsSchema } from "@/lib/domains/config";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), context: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireClientView: mocks.permission }));
vi.mock("@/lib/services/context", () => ({ getAppContext: mocks.context }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookie }) }));
const master = googleDomainsSchema.parse({ version: 1, domains: [{ id: "future_fourth", name: "Dominio futuro", accounts: [{ customerId: "4444444444", name: "Cuatro" }], absoluteTopMinimum: 0.2 }], absoluteTop: { minImpressions: 41, warningGapPp: 4, suddenDropThresholdPp: 8, deepeningGapPp: 6, repeatAfterHours: 9, retentionDays: 80 } });
const request = (body: unknown) => new Request("http://monitor.test/api/domain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ role: "client", permissions: ["client:view"] }); mocks.context.mockResolvedValue({ brand: "izzi", domainConfig: master }); });
afterEach(() => vi.unstubAllEnvs());

describe("authenticated domain view preference", () => {
  it("requires a view session before reading configuration or changing cookies", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await POST(request({ domain: "future_fourth" }))).status).toBe(401);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("supports future configured domains for a client without exposing master account IDs", async () => {
    const response = await POST(request({ domain: "future_fourth" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, domain: { id: "future_fourth", name: "Dominio futuro", available: true } });
    expect(JSON.stringify(body)).not.toContain("4444444444");
    expect(mocks.cookie).toHaveBeenCalledWith("immc_domain", "future_fourth", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });
  it.each(["../one", "GOOGLE", "alpha,beta", ""])('rejects malformed preference "%s" before reading context', async domain => {
    expect((await POST(request({ domain }))).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("blocks an unknown or unavailable domain without silently saving all", async () => {
    expect((await POST(request({ domain: "unknown" }))).status).toBe(400);
    mocks.context.mockResolvedValue({ brand: "izzi", domainConfig: null });
    expect((await POST(request({ domain: "future_fourth" }))).status).toBe(400);
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("allows reset to all without a master and uses Secure cookies in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.context.mockResolvedValue({ brand: "izzi", domainConfig: null });
    expect((await POST(request({ domain: "all" }))).status).toBe(200);
    expect(mocks.cookie).toHaveBeenCalledWith("immc_domain", "all", expect.objectContaining({ secure: true }));
  });
  it("prevents applying an izzi domain to Sky", async () => {
    mocks.context.mockResolvedValue({ brand: "sky", domainConfig: master });
    expect((await POST(request({ domain: "future_fourth" }))).status).toBe(403);
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect((await POST(request({ domain: "all" }))).status).toBe(200);
  });
});
