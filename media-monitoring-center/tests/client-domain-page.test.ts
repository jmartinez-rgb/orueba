import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClientPage from "@/app/(client)/cliente/page";
import { nexusSnapshot } from "./nexus-fixtures";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), context: vi.fn(), budget: vi.fn() }));
vi.mock("@/lib/services/safe", () => ({ safeSnapshot: mocks.snapshot }));
vi.mock("@/lib/services/context", () => ({ getViewContext: mocks.context }));
vi.mock("@/lib/services/budget", () => ({ getBudgetControl: mocks.budget }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ domain: { id: "fixture_domain", name: "Dominio de prueba", available: true, configVersion: 4 } });
  mocks.budget.mockResolvedValue({ lines: [] });
});

function snapshot() {
  const snap = nexusSnapshot();
  snap.meta.domain = { id: "fixture_domain", name: "Dominio de prueba", available: true, configVersion: 4 };
  snap.meta.lastDataAt = "2026-10-02T17:00:00Z";
  snap.meta.nextEvaluationAt = "2026-10-02T17:15:00Z";
  snap.run.platforms = ["google"];
  snap.run.pacing = { google: { pctOfExpected: 1 }, total: { pctOfExpected: 1 } } as typeof snap.run.pacing;
  snap.run.platformStatus = { google: { dataState: "PARTIAL", severity: "NORMAL" } } as typeof snap.run.platformStatus;
  return snap;
}

describe("client domain page public boundary", () => {
  it("renders the scope and partial-data state without operational snapshot details", async () => {
    mocks.snapshot.mockResolvedValue({ ok: true, snap: snapshot() });
    const markup = renderToStaticMarkup(await ClientPage());
    expect(markup).toContain("Alcance: ");
    expect(markup).toContain("Dominio de prueba");
    expect(markup).toContain("Actualizando datos");
    expect(markup).not.toMatch(/PRIVATE|ALERT-1|INC-1|acc1|sky-secret|Promociones|Nexus|campaignId/);
  });

  it("renders an empty selection as missing scope rather than campaign normality", async () => {
    const snap = snapshot();
    snap.catalog.accounts = [];
    snap.catalog.campaigns = [];
    mocks.snapshot.mockResolvedValue({ ok: true, snap });
    const markup = renderToStaticMarkup(await ClientPage());
    expect(markup).toContain("Sin cuentas en este alcance");
    expect(markup).not.toContain("Todo en orden");
    expect(markup).not.toMatch(/PRIVATE|ALERT-1|INC-1|Nexus/);
  });
});
