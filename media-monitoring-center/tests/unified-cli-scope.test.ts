import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedMapping } from "@/lib/unified/schema";

const mocks = vi.hoisted(() => ({ loadEnv: vi.fn(), getEnv: vi.fn(), mapping: vi.fn(), sync: vi.fn(), refresh: vi.fn() }));
vi.mock("@next/env", () => ({ loadEnvConfig: mocks.loadEnv }));
vi.mock("@/lib/config/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/lib/unified/store", async original => ({ ...(await original()), loadUnifiedMapping: mocks.mapping }));
vi.mock("@/lib/unified/sync", () => ({ syncUnified: mocks.sync }));
vi.mock("@/lib/unified/refresh", () => ({ refreshUnified: mocks.refresh }));

const accounts: UnifiedMapping["accounts"] = [
  { platform: "tiktok", accountId: "izzi1", brand: "izzi", currency: "MXN" },
  { platform: "tiktok", accountId: "sky1", brand: "sky", currency: "MXN" },
  { platform: "tiktok", accountId: "izzi2", brand: "izzi", currency: "USD" },
  { platform: "google", accountId: "izzi3", brand: "izzi", currency: "MXN" },
  { platform: "google", accountId: "sky2", brand: "sky", currency: "USD" },
];
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalLogLevel = process.env.LOG_LEVEL;
beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getEnv.mockReturnValue({ dataSource: "unified", timezone: "America/Mexico_City", unifiedData: { directory: "/tmp/nonexistent-worker-test" }, unifiedApi: { url: "https://offline.example.test", apiKey: "synthetic-not-real" } });
  mocks.mapping.mockResolvedValue({ version: 1, accounts });
  mocks.sync.mockResolvedValue([{ status: "SUCCESS", rows: 1 }]);
  mocks.refresh.mockResolvedValue([{ status: "SUCCESS", rows: 1, nextDueAt: "2026-10-03T12:00:00Z" }]);
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;
  vi.restoreAllMocks();
});

const workers = [
  { name: "sync", execute: () => import("../scripts/unified-sync"), operation: mocks.sync, invalid: "INVALID_OPTIONS" },
  { name: "refresh", execute: () => import("../scripts/unified-refresh"), operation: mocks.refresh, invalid: "INVALID_REFRESH_OPTIONS" },
];
describe.each(workers)("$name worker explicit scope without transport", worker => {
  it("passes only izzi to the operation, including multiple accounts of the same platform", async () => {
    process.argv = [process.execPath, "worker-fixture", "--brand", "izzi"];
    await worker.execute();
    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(worker.operation).toHaveBeenCalledTimes(1);
    expect(worker.operation.mock.calls[0][0].mapping.accounts.map((a: { accountId: string }) => a.accountId)).toEqual(["izzi1", "izzi2", "izzi3"]);
  });
  it("retains both brands without the new option", async () => {
    process.argv = [process.execPath, "worker-fixture"];
    await worker.execute();
    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(worker.operation.mock.calls[0][0].mapping.accounts).toEqual(accounts);
  });
  it("intersects brand with provider before the operation", async () => {
    process.argv = [process.execPath, "worker-fixture", "--provider", "tiktok", "--brand", "izzi"];
    await worker.execute();
    await vi.waitFor(() => expect(process.exitCode).toBe(0));
    expect(worker.operation.mock.calls[0][0].mapping.accounts.map((a: { accountId: string }) => a.accountId)).toEqual(["izzi1", "izzi2"]);
  });
  it("invalid brand fails before loading environment or invoking the operation", async () => {
    process.argv = [process.execPath, "worker-fixture", "--brand", "private-invalid-value"];
    await worker.execute();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.loadEnv).not.toHaveBeenCalled();
    expect(mocks.getEnv).not.toHaveBeenCalled();
    expect(worker.operation).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(JSON.stringify({ source: "unified", code: worker.invalid }));
  });
  it("explicit missing brand does not fall back to Sky accounts", async () => {
    mocks.mapping.mockResolvedValue({ version: 1, accounts: accounts.filter(a => a.brand === "sky") });
    process.argv = [process.execPath, "worker-fixture", "--brand", "izzi"];
    await worker.execute();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(worker.operation).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(JSON.stringify({ source: "unified", code: "NO_MAPPED_ACCOUNTS" }));
  });
  it("help documents the optional brand and returns without environment or API operations", async () => {
    process.argv = [process.execPath, "worker-fixture", "--ayuda"];
    await worker.execute();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("--brand izzi|sky"));
    expect(mocks.loadEnv).not.toHaveBeenCalled();
    expect(worker.operation).not.toHaveBeenCalled();
  });
});
