import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/budgets/route";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), full: vi.fn(), view: vi.fn(), write: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/services/context", () => ({ getAppContext: mocks.full, getViewContext: mocks.view }));
vi.mock("@/lib/services/activity", () => ({ logActivity: mocks.activity }));
const request = (level: "total" | "platform" | "account" | "campaign") => new Request("http://monitor.test/api/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: "2026-10", level, platform: level === "total" ? null : "google", accountId: ["account", "campaign"].includes(level) ? "google:1111111111" : null, campaignId: level === "campaign" ? "google:1111111111:campaign" : null, amount: 1000 }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ role: "admin", permissions: ["budgets:write"] });
  mocks.full.mockResolvedValue({ store: { setBudget: mocks.write } });
  mocks.view.mockResolvedValue({ domain: { id: "fixture_domain" } });
});
describe("budget references remain complete-brand records", () => {
  it.each(["total", "platform", "account", "campaign"] as const)("does not persist a %s reference from a selected-domain view", async level => {
    expect((await PUT(request(level))).status).toBe(409);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("preserves an authorized edit after selecting all", async () => {
    mocks.view.mockResolvedValue({ domain: { id: "all" } });
    expect((await PUT(request("total"))).status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ level: "total", amount: 1000 }));
    expect(mocks.activity).toHaveBeenCalledOnce();
  });
  it("requires budget permission before reading the browser's view", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await PUT(request("total"))).status).toBe(403);
    expect(mocks.view).not.toHaveBeenCalled();
    expect(mocks.full).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
