import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/absolute-top/route";
import { absoluteTopViewSnapshot } from "./absolute-top-view-fixtures";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), brand: vi.fn(), context: vi.fn(), dashboard: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/services/brand", () => ({ resolveBrand: mocks.brand }));
vi.mock("@/lib/services/context", () => ({ getViewContext: mocks.context }));
vi.mock("@/lib/absolute-top/service", () => ({ getAbsoluteTopDashboard: mocks.dashboard }));
const request = (params = "") => new NextRequest(`http://localhost/api/absolute-top${params}`);

beforeEach(() => {
  vi.resetAllMocks();
  const snapshot = absoluteTopViewSnapshot();
  mocks.permission.mockResolvedValue({ authenticated: true, role: "auditor", brands: ["izzi"], permissions: ["internal:view"] });
  mocks.brand.mockResolvedValue("izzi");
  mocks.context.mockResolvedValue({ brand: "izzi", domain: { id: "all", available: true }, domainConfig: { domains: snapshot.domains, absoluteTop: snapshot.policy, version: 1 }, source: { getCatalog: vi.fn().mockResolvedValue({ accounts: [{ id: "google:1234567890", platform: "google", brand: "izzi" }] }) } });
  mocks.dashboard.mockResolvedValue(snapshot);
});

describe("Absolute Top stored read API", () => {
  it("checks authentication and internal permission before reading context or storage", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.permission).toHaveBeenCalledWith("internal:view");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
  it("rejects clients even with an inconsistent internal permission", async () => {
    mocks.permission.mockResolvedValue({ role: "client", brands: ["izzi"], permissions: ["internal:view"] });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
  it("denies accounts restricted to Sky and the active Sky context without reading izzi", async () => {
    mocks.permission.mockResolvedValue({ role: "admin", brands: ["sky"] });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.brand).not.toHaveBeenCalled();
    mocks.permission.mockResolvedValue({ role: "admin", brands: ["izzi", "sky"] });
    mocks.brand.mockResolvedValue("sky");
    expect((await GET(request())).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
  it("blocks a stale-tab brand change rather than leaking stored izzi data", async () => {
    mocks.context.mockResolvedValue({ brand: "sky", domain: { id: "all" } });
    expect((await GET(request())).status).toBe(409);
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
  it("validates arbitrary central domain IDs, does not hardcode domain enumeration", async () => {
    expect((await GET(request("?domain=custom_domain"))).status).toBe(200);
    expect(mocks.dashboard.mock.calls[0][0].domainId).toBe("custom_domain");
    for (const params of ["?domain=unknown", "?domain=", "?domain=all&domain=custom_domain", "?brand=sky"]) expect((await GET(request(params))).status).toBe(400);
    expect(mocks.dashboard).toHaveBeenCalledOnce();
  });
  it("honors the global domain selection, using offline master and private no-store responses", async () => {
    const context = await mocks.context();
    context.domain.id = "custom_domain";
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.dashboard).toHaveBeenCalledWith({ brand: "izzi", domainId: "custom_domain", config: context.domainConfig, allowedCustomerIds: ["1234567890"] });
    expect((await response.json()).module).toBe("ABSOLUTE_TOP_MONITORING");
  });
  it("keeps configured-without-audits and partial coverage explicit rather than healthy", async () => {
    const snapshot = absoluteTopViewSnapshot();
    snapshot.available = false; snapshot.rows = []; snapshot.lastAuditAt = null;
    mocks.dashboard.mockResolvedValue(snapshot);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: false, configured: true, lastAuditAt: null, rows: [] });
    snapshot.available = true; snapshot.rows = [absoluteTopViewSnapshot().rows[1]]; snapshot.rows[0].coverage = "partial";
    expect((await (await GET(request())).json()).rows[0]).toMatchObject({ coverage: "partial", state: "below" });
  });
  it("does not expose error details, tokens or signed URLs and cannot claim success on storage error", async () => {
    mocks.dashboard.mockRejectedValue(new Error("access_token=PRIVATE signed=https://private.invalid/callback?code=SECRET"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toMatch(/PRIVATE|SECRET|private.invalid|healthy/);
    expect(JSON.parse(text).ok).toBe(false);
  });
  it("limits stored reads to current Google izzi accounts, independent of central master membership", async () => {
    const context = await mocks.context();
    context.source.getCatalog.mockResolvedValue({ accounts: [{ id: "google:1234567890", platform: "google", brand: "izzi" }, { id: "google:9876543210", platform: "google", brand: "sky" }, { id: "google:bad", platform: "google", brand: "izzi" }, { id: "meta:1234567890", platform: "meta", brand: "izzi" }] });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.dashboard.mock.calls[0][0].allowedCustomerIds).toEqual(["1234567890"]);
  });
});
