import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import PlatformPage from "@/app/(app)/platforms/[platform]/page";
import { GET as absoluteTop } from "@/app/api/absolute-top/route";

/**
 * Los dominios clasifican solo cuentas de Google Ads: la preferencia de dominio se aplica en la página de
 * Google Ads y en Absolute Top; cualquier otra plataforma se lee con la marca completa.
 */
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), context: vi.fn(), permission: vi.fn(), brand: vi.fn(), dashboard: vi.fn() }));
vi.mock("@/lib/services/safe", () => ({ safeSnapshot: mocks.snapshot }));
vi.mock("@/lib/services/context", () => ({ getViewContext: mocks.context }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/services/brand", () => ({ resolveBrand: mocks.brand }));
vi.mock("@/lib/absolute-top/service", () => ({ getAbsoluteTopDashboard: mocks.dashboard }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot.mockResolvedValue({ ok: false, message: "Fixture", technical: "" });
});

describe("Google domain preference only on Google views", () => {
  it("Google Ads reads the domain scope; Meta and the other platforms read the whole brand", async () => {
    await PlatformPage({ params: Promise.resolve({ platform: "meta" }) });
    expect(mocks.snapshot).toHaveBeenLastCalledWith("brand");
    await PlatformPage({ params: Promise.resolve({ platform: "tiktok" }) });
    expect(mocks.snapshot).toHaveBeenLastCalledWith("brand");
    await PlatformPage({ params: Promise.resolve({ platform: "google" }) });
    expect(mocks.snapshot).toHaveBeenLastCalledWith("domain");
  });

  it("Absolute Top keeps reading the selected domain", async () => {
    mocks.permission.mockResolvedValue({ role: "admin", brands: ["izzi"], permissions: ["internal:view"] });
    mocks.brand.mockResolvedValue("izzi");
    mocks.context.mockResolvedValue({ brand: "izzi", domain: { id: "first", available: true }, domainConfig: null, source: { getCatalog: vi.fn().mockResolvedValue({ accounts: [] }) } });
    mocks.dashboard.mockResolvedValue({ selectedDomain: "first" });
    expect((await absoluteTop(new NextRequest("http://localhost/api/absolute-top"))).status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith(undefined, "domain");
    expect(mocks.dashboard).toHaveBeenCalledWith(expect.objectContaining({ domainId: "first" }));
  });
});
