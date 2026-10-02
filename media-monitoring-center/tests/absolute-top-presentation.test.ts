import { describe, expect, it } from "vitest";
import { campaignKey, countText, ctrText, EMPTY_FILTERS, filterAbsoluteTopRows, measuredAtText, moneyText, pointText, rateText, shareText, windowText } from "@/components/absolute-top/presentation";
import { absoluteTopViewRow, absoluteTopViewSnapshot } from "./absolute-top-view-fixtures";

describe("Absolute Top presentation", () => {
  it("preserves native CTR over 100 without expanding the valid Absolute Top range", () => {
    expect(ctrText(120)).toBe("120.0%");
    expect(ctrText(0)).toBe("0.0%");
    expect(ctrText(null)).toBe("N/D");
    expect(rateText(1.2)).toBe("N/D");
  });
  it("shows native ratios and preserves valid zero rather than substituting missing values", () => {
    expect(rateText(0)).toBe("0.0%");
    expect(rateText(0.0999)).toBe("10.0%");
    expect(rateText(0.9001)).toBe("90.0%");
    expect(rateText(0.7)).toBe("70.0%");
    for (const value of [null, undefined, NaN, Infinity, -0.1, 1.1]) expect(rateText(value)).toBe("N/D");
  });
  it("formats gaps as percentage points, including negative zero, not relative changes", () => {
    expect(pointText(-8)).toBe("−8.0 pp");
    expect(pointText(4)).toBe("+4.0 pp");
    expect(pointText(-0.00001)).toBe("0.0 pp");
    expect(pointText(null)).toBe("N/D");
  });
  it("does not pretend bounded Impression Share values are exact or unknown", () => {
    expect(shareText(null, "lt_10_percent")).toBe("<10%");
    expect(shareText(null, "gt_90_percent")).toBe(">90%");
    expect(shareText(null)).toBe("N/D");
    expect(shareText(0.47)).toBe("47.0%");
  });
  it("keeps costs in their native currency and does not invent currency or timezone", () => {
    expect(moneyText(0, "USD")).toMatch(/USD/);
    expect(moneyText(25, "MXN")).toMatch(/MXN/);
    expect(moneyText(25, null)).toBe("N/D");
    expect(moneyText(null, "MXN")).toBe("N/D");
    expect(moneyText(25, "INVALID")).toBe("N/D");
    expect(measuredAtText("invalid", "UTC")).toBe("N/D");
    expect(measuredAtText("2026-10-02T15:00:00Z", "invalid-zone")).toBe("N/D");
    expect(measuredAtText(null, "UTC")).toBe("Sin auditoría");
    expect(countText(null)).toBe("N/D");
    expect(countText(0)).toBe("0");
  });
  it("sorts by descending supplied priority without mutating rows or inheriting parent status", () => {
    const rows = absoluteTopViewSnapshot().rows;
    const sorted = filterAbsoluteTopRows(rows, EMPTY_FILTERS);
    expect(sorted.map((row) => row.level)).toEqual(["ad_group", "campaign"]);
    expect(rows.map((row) => row.level)).toEqual(["campaign", "ad_group"]);
    expect(sorted[0].state).toBe("below");
    expect(sorted[1].state).toBe("meets");
  });
  it("filters every requested secondary dimension independently", () => {
    const rows = absoluteTopViewSnapshot().rows;
    for (const [field, value] of [["account", "1234567890"], ["campaign", "1234567890:456"]]) expect(filterAbsoluteTopRows(rows, { ...EMPTY_FILTERS, [field]: value })).toHaveLength(2);
    for (const [field, value] of [["adGroup", rows[1].entity_key], ["level", "ad_group"], ["state", "below"], ["severity", "CRITICAL"]]) expect(filterAbsoluteTopRows(rows, { ...EMPTY_FILTERS, [field]: value }).map((row) => row.entity_key)).toEqual([rows[1].entity_key]);
    expect(filterAbsoluteTopRows(rows, { ...EMPTY_FILTERS, account: "unknown" })).toEqual([]);
    expect(filterAbsoluteTopRows(rows, { ...EMPTY_FILTERS, level: "campaign", state: "below" })).toEqual([]);
  });
  it("separates campaigns with the same platform ID in different accounts", () => {
    const first = absoluteTopViewRow();
    const second = absoluteTopViewRow({ customer_id: "9876543210", entity_key: "9876543210:campaign:456" });
    expect(campaignKey(first)).not.toBe(campaignKey(second));
    expect(filterAbsoluteTopRows([first, second], { ...EMPTY_FILTERS, campaign: campaignKey(first) })).toEqual([first]);
  });
  it("labels accumulated source windows using the exclusive end boundary rather than an individual hour", () => {
    expect(windowText(absoluteTopViewRow({ window_from: "2026-10-01", window_to: "2026-10-02", window_end_hour: 14 }))).toContain("acumulado hasta 15:00");
    expect(windowText(absoluteTopViewRow({ window_from: "2026-10-01", window_to: "2026-10-02", window_end_hour: 23 }))).toContain("acumulado hasta 24:00");
    expect(windowText(absoluteTopViewRow({ window_from: "2026-10-01", window_to: "2026-10-01", window_end_hour: null }))).toContain("días completos");
  });
});
