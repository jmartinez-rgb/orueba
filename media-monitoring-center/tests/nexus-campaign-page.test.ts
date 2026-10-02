import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import CampaignsPage from "@/app/(app)/campaigns/page";
import type { CampaignRowVM } from "@/lib/services/view-models";
import { nexusSnapshot } from "./nexus-fixtures";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), rows: vi.fn() }));
vi.mock("@/lib/services/safe", () => ({ safeSnapshot: mocks.snapshot }));
vi.mock("@/lib/services/view-models", () => ({ campaignRows: mocks.rows }));

beforeEach(() => {
  const snapshot = nexusSnapshot();
  snapshot.meta.historyWeeks = 4;
  snapshot.settings.thresholds = { attention: .15 } as typeof snapshot.settings.thresholds;
  mocks.snapshot.mockResolvedValue({ ok: true, snap: snapshot });
  const paused: CampaignRowVM = {
    id: "54321", name: "Paused linked campaign", platform: "google", accountName: "izzi", objective: "TRAFFIC", status: "PAUSED",
    statusText: "PAUSED", statusIssue: false, statusSilent: false, dataState: "OK", spend: 0, expected: 100,
    deviation: -1, vsPrev: null, histDeviation: null, resultLabel: "Clics", resultMetric: "clicks", results: 0,
    resultsExpected: 10, resultsDeviation: -1, resultLagging: false, costLabel: "CPC", cost: null, costDeviation: null,
    alertSeverity: null, alertType: null, alertId: null, grouped: false, impact: 100, share: null,
  };
  mocks.rows.mockReturnValue([paused, { ...paused, id: "12345", name: "Another campaign", status: "ACTIVE" }, { ...paused, name: "Different platform campaign", platform: "meta" }]);
});

it("applies the campaign citation query all the way from the Next page Promise to rendered rows", async () => {
  const page = await CampaignsPage({ searchParams: Promise.resolve({ search: "54321", platform: "google" }) });
  const markup = renderToStaticMarkup(page);
  expect(markup).toContain("Paused linked campaign");
  expect(markup).not.toContain("Another campaign");
  expect(markup).not.toContain("Different platform campaign");
  expect(markup).toContain('value="54321"');
});

it("does not accept repeated search/platform query values as executable or arbitrary filters", async () => {
  const page = await CampaignsPage({ searchParams: Promise.resolve({ search: ["54321", "<script>"], platform: ["google", "meta"] }) });
  const markup = renderToStaticMarkup(page);
  expect(markup).toContain("Another campaign");
  expect(markup).not.toContain("Paused linked campaign");
  expect(markup).not.toContain("&lt;script&gt;");
});
