import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fmtDelta, fmtMetric } from "@/lib/format";
import { DeltaText } from "@/components/monitoring/status";

describe("rate gaps in shared alert and incident displays", () => {
  it.each([[-.08, "−8.0 pp"], [.04, "+4.0 pp"], [0, "0.0 pp"]])("formats the fraction %s in points, not relative percent", (value, expected) => {
    expect(fmtDelta(value as number, 1, "pp")).toBe(expected);
    expect(renderToStaticMarkup(createElement(DeltaText, { value: value as number, unit: "pp" }))).toContain(expected);
  });
  it("keeps ordinary performance deviations expressed as percentages", () => {
    expect(fmtDelta(-.08)).toBe("−8.0%");
    expect(renderToStaticMarkup(createElement(DeltaText, { value: -.08 }))).toContain("−8.0%");
  });
  it("shows the absolute rate in percent while its gap is in pp", () => {
    expect(fmtMetric("absolute_top_rate", .62)).toBe("62.00%");
    expect(fmtDelta(.62 - .7, 1, "pp")).toBe("−8.0 pp");
  });
  it("keeps unknown non-finite gaps absent and rounds zero without a stray decimal", () => {
    expect(fmtDelta(null, 0, "pp")).toBe("—");
    expect(fmtDelta(NaN, 0, "pp")).toBe("—");
    expect(fmtDelta(0, 0, "pp")).toBe("0 pp");
    expect(renderToStaticMarkup(createElement(DeltaText, { value: 0, unit: "pp", digits: 0 }))).toContain("0 pp");
  });
});
