import { describe, expect, it } from "vitest";
import { filterUnifiedMapping, parseRefreshOptions, parseSyncOptions, type UnifiedSelection } from "@/lib/unified/cli-options";
import type { UnifiedMapping } from "@/lib/unified/schema";

const mapping: UnifiedMapping = {
  version: 1,
  accounts: [
    { platform: "tiktok", accountId: "izzi1", brand: "izzi", currency: "MXN" },
    { platform: "tiktok", accountId: "sky1", brand: "sky", currency: "MXN" },
    { platform: "tiktok", accountId: "izzi2", brand: "izzi", currency: "USD" },
    { platform: "google", accountId: "sky2", brand: "sky", currency: "USD" },
    { platform: "google", accountId: "izzi3", brand: "izzi", currency: "MXN" },
  ],
};

describe("explicit optional brand scope for unified workers", () => {
  it("keeps the previous defaults and all configured brands when no filter is present", () => {
    expect(parseSyncOptions([])).toEqual({ granularity: "both" });
    expect(parseRefreshOptions([])).toEqual({ watch: false, intervalMinutes: 120 });
    expect(filterUnifiedMapping(mapping, {})).toEqual(mapping);
  });
  it.each([parseSyncOptions, parseRefreshOptions])("retains all izzi accounts across platforms and currencies while excluding Sky", parse => {
    const options = parse(["--brand", "izzi"]);
    const selected = filterUnifiedMapping(mapping, options);
    expect(selected.accounts.map(a => a.accountId)).toEqual(["izzi1", "izzi2", "izzi3"]);
    expect(selected.accounts.map(a => a.currency)).toEqual(["MXN", "USD", "MXN"]);
    expect(selected.accounts.every(a => a.brand === "izzi")).toBe(true);
  });
  it.each([parseSyncOptions, parseRefreshOptions])("selects Sky explicitly and intersects brand with provider", parse => {
    expect(filterUnifiedMapping(mapping, parse(["--brand", "sky"])).accounts.map(a => a.accountId)).toEqual(["sky1", "sky2"]);
    expect(filterUnifiedMapping(mapping, parse(["--provider", "tiktok", "--brand", "izzi"])).accounts.map(a => a.accountId)).toEqual(["izzi1", "izzi2"]);
    expect(filterUnifiedMapping(mapping, parse(["--brand", "sky", "--provider", "google"])).accounts.map(a => a.accountId)).toEqual(["sky2"]);
  });
  it("provider alone preserves both brands and does not mutate the original mapping", () => {
    const copy = structuredClone(mapping);
    const selected = filterUnifiedMapping(mapping, { provider: "tiktok" });
    expect(selected.accounts.map(a => a.brand)).toEqual(["izzi", "sky", "izzi"]);
    expect(mapping).toEqual(copy);
    expect(selected.accounts).not.toBe(mapping.accounts);
  });
  it("no matching explicit brand/provider fails rather than falling back to another brand", () => {
    const onlySky: UnifiedMapping = { version: 1, accounts: mapping.accounts.filter(a => a.brand === "sky") };
    expect(() => filterUnifiedMapping(onlySky, { brand: "izzi" })).toThrow(/NO_MAPPED_ACCOUNTS/);
    expect(() => filterUnifiedMapping(mapping, { provider: "spotify", brand: "izzi" })).toThrow(/NO_MAPPED_ACCOUNTS/);
  });
  it.each(["all", "ambas", "IZZI", "", "private-invalid-value"])("the pure filter rejects invalid runtime brand %s", brand => {
    expect(() => filterUnifiedMapping(mapping, { brand } as UnifiedSelection)).toThrow(/INVALID_OPTIONS/);
  });
  it.each([
    ["--brand"], ["--brand", "--provider", "google"], ["--brand", "all"],
    ["--brand", "izzi", "--brand", "sky"], ["--provider", "unknown"],
    ["--provider", "google", "--provider", "tiktok"], ["--unknown", "value"],
  ].map(args => ({ args })))("both parsers reject malformed/duplicate brand or provider arguments: $args", ({ args }) => {
    expect(() => parseSyncOptions(args)).toThrow(/INVALID_OPTIONS/);
    expect(() => parseRefreshOptions(args)).toThrow(/INVALID_REFRESH_OPTIONS/);
  });
  it("sync preserves date/granularity arguments while adding the explicit scope", () => {
    expect(parseSyncOptions(["--from", "2026-09-30", "--to", "2026-10-01", "--granularity", "hourly", "--brand", "izzi"])).toEqual({ from: "2026-09-30", to: "2026-10-01", granularity: "hourly", brand: "izzi" });
    expect(() => parseSyncOptions(["--granularity", "weekly"])).toThrow(/INVALID_OPTIONS/);
  });
  it("refresh preserves watch and bounded intervals with brand/provider in any order", () => {
    expect(parseRefreshOptions(["--watch", "--brand", "izzi", "--interval-minutes", "30", "--provider", "meta"])).toEqual({ watch: true, brand: "izzi", intervalMinutes: 30, provider: "meta" });
    expect(parseRefreshOptions(["--interval-minutes", "1440", "--brand", "sky", "--watch"]).intervalMinutes).toBe(1440);
  });
  it.each(["29", "1441", "NaN", "Infinity", "30.5", "-30", "3e2"])("refresh rejects invalid interval %s", interval => {
    expect(() => parseRefreshOptions(["--interval-minutes", interval, "--brand", "izzi"])).toThrow(/INVALID_REFRESH_OPTIONS/);
  });
  it("refresh rejects duplicate standalone watch and unexpected sync-only flags", () => {
    expect(() => parseRefreshOptions(["--watch", "--watch"])).toThrow(/INVALID_REFRESH_OPTIONS/);
    expect(() => parseRefreshOptions(["--brand", "izzi", "--from", "2026-09-30"])).toThrow(/INVALID_REFRESH_OPTIONS/);
  });
});
