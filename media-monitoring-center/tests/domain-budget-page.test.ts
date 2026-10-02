import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import BudgetPage from "@/app/(app)/budget/page";
import { BudgetTable } from "@/components/monitoring/budget-table";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { nexusSnapshot } from "./nexus-fixtures";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), view: vi.fn(), full: vi.fn(), build: vi.fn(), control: vi.fn(), budgets: vi.fn(), overview: vi.fn(), photo: vi.fn(), previous: vi.fn(), save: vi.fn(), changes: vi.fn() }));
vi.mock("@/lib/services/safe", () => ({ safeSnapshot: mocks.snapshot }));
vi.mock("@/lib/services/context", () => ({ getViewContext: mocks.view, getAppContext: mocks.full }));
vi.mock("@/lib/services/snapshot", () => ({ buildSnapshot: mocks.build }));
vi.mock("@/lib/services/budget", () => ({ getBudgetControl: mocks.control }));
vi.mock("@/lib/integrations/unified-api", () => ({ unifiedBudgets: mocks.budgets }));
vi.mock("@/lib/services/platform-budgets", () => ({ buildBudgetOverview: mocks.overview }));
vi.mock("@/lib/services/budget-changes", () => ({ snapshotFrom: mocks.photo, detectBudgetChanges: mocks.changes, demoPreviousSnapshot: vi.fn() }));
vi.mock("@/lib/records/budget-snapshots", () => ({ latestSnapshotBefore: mocks.previous, saveBudgetSnapshot: mocks.save }));

function snapshot() {
  const snap = nexusSnapshot();
  snap.catalog.accounts = snap.catalog.accounts.filter(account => account.brand === "izzi");
  snap.catalog.campaigns = []; snap.run.entities = []; snap.run.platforms = ["google"];
  snap.run.businessDate = "2026-10-02"; snap.meta.businessDate = "2026-10-02"; snap.meta.generatedAt = "2026-10-02T18:00:00Z";
  snap.run.pacing = { google: { curveShare: 1 } } as typeof snap.run.pacing;
  snap.meta.permissions = ["budgets:write"]; snap.settings = structuredClone(DEFAULT_SETTINGS);
  return snap;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot.mockResolvedValue({ ok: true, snap: snapshot() });
  mocks.view.mockResolvedValue({ domain: { id: "all" } });
  mocks.full.mockResolvedValue({ domain: { id: "all" } });
  mocks.build.mockResolvedValue(snapshot());
  mocks.control.mockResolvedValue({ month: "2026-10", elapsedDays: 1, daysInMonth: 31, lines: [], accounts: [], fxRate: null });
  mocks.budgets.mockResolvedValue({ ok: true, budgets: [], warnings: [] });
  mocks.overview.mockImplementation((input: { directAccounts: Map<string, string> }) => ({ insights: [], marker: [...input.directAccounts.keys()] }));
  mocks.photo.mockImplementation((overview: { marker: string[] }, date: string, at: string) => ({ date, at, units: Object.fromEntries(overview.marker.map(id => [id, {}])) }));
  mocks.previous.mockResolvedValue({ date: "2026-10-01", units: {} }); mocks.changes.mockReturnValue({});
});
function find(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, type); if (match) return match; } return; }
  if (!isValidElement(node)) return;
  if (node.type === type) return node;
  return find((node.props as { children?: ReactNode }).children, type);
}
describe("budget photos and editing under domain views", () => {
  it("preserves only a complete-brand photo and renders a domain's monetary table as read-only", async () => {
    const partial = snapshot(); partial.catalog.accounts = partial.catalog.accounts.slice(0, 1);
    mocks.snapshot.mockResolvedValue({ ok: true, snap: partial });
    mocks.view.mockResolvedValue({ domain: { id: "one" } });
    const page = await BudgetPage();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(Object.keys(mocks.save.mock.calls[0][1].units)).toEqual(["acc1", "acc2"]);
    expect(mocks.changes).toHaveBeenCalledOnce();
    expect((find(page, BudgetTable)?.props as { canEdit: boolean }).canEdit).toBe(false);
  });
  it("does not save an incomplete provider read or infer disappearance from its subtotal", async () => {
    mocks.budgets.mockResolvedValue({ ok: true, budgets: [], warnings: ["Una lectura falló"] });
    await BudgetPage();
    expect(mocks.previous).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.changes).not.toHaveBeenCalled();
  });
  it("keeps editing and the photo comparison available for a complete all-domain view", async () => {
    const page = await BudgetPage();
    expect((find(page, BudgetTable)?.props as { canEdit: boolean }).canEdit).toBe(true);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.changes).toHaveBeenCalledOnce();
  });
});
