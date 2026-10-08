import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/reports/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), brand: vi.fn(), cookies: vi.fn(), list: vi.fn(), save: vi.fn(), activity: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/session", () => ({ requireAuth: mocks.auth, requirePermission: mocks.permission }));
vi.mock("@/lib/services/brand", () => ({ resolveBrand: mocks.brand }));
vi.mock("@/lib/records/reports", () => ({ listReports: mocks.list, saveReport: mocks.save }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));

const request = () => new Request("http://localhost/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Fixture report message with enough length.", businessDate: "2026-10-02", cutoffHour: 12, platforms: ["google"], summary: "Fixture summary" }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: "Fixture operator" } });
  mocks.permission.mockResolvedValue({ user: { name: "Fixture operator" } });
  mocks.brand.mockResolvedValue("izzi");
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "all" }) });
  mocks.list.mockResolvedValue([]);
  mocks.save.mockResolvedValue({ id: "RPT-FIXTURE" });
});

describe("brand report history and the Google domain preference", () => {
  it("a Google domain preference never narrows Monitoreos: history and saving stay brand-wide", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "fixture_domain" }) });
    const read = await GET();
    expect(read.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(30, "izzi");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ brand: "izzi" }));
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("preserves full-scope storage and brand authorization", async () => {
    expect((await GET()).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(30, "izzi");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ brand: "izzi", by: "Fixture operator" }));
    expect(mocks.activity).toHaveBeenCalledOnce();
  });

  it("ignores an izzi domain cookie when the authorized brand is Sky", async () => {
    mocks.brand.mockResolvedValue("sky");
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "fixture_domain" }) });
    expect((await GET()).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(30, "sky");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ brand: "sky" }));
  });

  it("still enforces authentication and report-write permission before scope handling", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.permission.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.brand).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
