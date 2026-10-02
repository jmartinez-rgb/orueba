import { describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { mkdtemp, readFile, stat, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyProviders, verificationSheets, yesterdayInZone } from "../src/verification/run.js";
import { rotationWriter } from "../src/verification/token-writer.js";
import { verificationArgs } from "../src/verification/cli-options.js";
import { writeWorkbook } from "../src/verification/output.js";
import { ApiError } from "../src/utils/errors.js";
import type { AdsProvider } from "../src/providers/provider.js";
import { Provider } from "../src/types/providers.js";
import type { NormalizedAccount, NormalizedPerformance } from "../src/types/normalized.js";

const account: NormalizedAccount = {
  platform: "tiktok",
  client_id: null,
  account_id: "7688066712031182866",
  account_name: "Cuenta =HYPERLINK()",
  currency: "USD",
  timezone: "America/Mexico_City",
  status: "ENABLED",
  manager_account_id: null,
};
const performance: NormalizedPerformance = {
  platform: "tiktok",
  client_id: null,
  account_id: account.account_id,
  account_name: account.account_name,
  campaign_id: "123",
  campaign_name: "Campaña",
  campaign_status: "active",
  objective: null,
  date: "2026-09-29",
  hour: null,
  currency: "USD",
  spend: 0,
  impressions: 0,
  reach: null,
  frequency: null,
  clicks: 0,
  link_clicks: null,
  conversions: null,
  conversion_value: null,
  ctr: null,
  cpc: null,
  cpm: null,
  cpa: null,
  video_views: null,
  video_25: null,
  video_50: null,
  video_75: null,
  video_100: null,
  source_timezone: account.timezone,
  extracted_at: "2026-10-01T00:00:00Z",
  raw_metrics: { access_token: "synthetic-private-marker", signed_url: "signed-private-marker" },
};
const now = new Date("2026-10-01T02:00:00Z");
function provider(): AdsProvider {
  return {
    id: Provider.TIKTOK,
    slug: "tiktok",
    name: "TikTok",
    implemented: true,
    requiredConfig: [],
    timeoutMs: 1000,
    isConfigured: () => true,
    status: async () => ({
      provider: "tiktok",
      name: "TikTok",
      state: "connected",
      configured: true,
      implemented: true,
      missing_config: [],
      last_successful_sync: null,
      last_error: null,
      latency_ms: 1,
      checked_at: now.toISOString(),
    }),
    listAccounts: vi.fn(async () => [account]),
    listCampaigns: vi.fn(async () => []),
    getConversions: vi.fn(async () => []),
    getPerformance: vi.fn(async (q) => [{ ...performance, account_id: q.account_id!, date: q.date_from }]),
  };
}
describe("verificar: cobertura real, privacidad y límites", () => {
  it("ayer usa la zona de la cuenta, no la zona del Mac ni UTC implícito", () => {
    expect(yesterdayInZone(now, "America/Mexico_City")).toBe("2026-09-29");
    expect(yesterdayInZone(now, "UTC")).toBe("2026-09-30");
    expect(yesterdayInZone(new Date("2026-03-09T02:00:00Z"), "America/Chicago")).toBe("2026-03-07");
    expect(() => yesterdayInZone(now, null)).toThrow();
    expect(() => yesterdayInZone(now, "Invalid/Zone")).toThrow();
  });
  it.each(["spotify", "microsoft"] as const)(
    "%s uses its documented UTC report day even with missing or vendor-specific account timezone",
    async (slug) => {
      const p = { ...provider(), slug, id: slug === "spotify" ? Provider.SPOTIFY : Provider.MICROSOFT };
      p.listAccounts = async () => [
        { ...account, platform: slug, timezone: slug === "spotify" ? null : "GuadalajaraMexicoCityMonterrey" },
      ];
      p.getPerformance = vi.fn(async (q) => [
        { ...performance, platform: slug, date: q.date_from, source_timezone: "UTC" },
      ]);
      const read = await verifyProviders([p], { now });
      expect(read.performance[0]).toMatchObject({ platform: slug, date: "2026-09-30", source_timezone: "UTC" });
      expect(read.operations.find((r) => r.section === "performance")?.state).toBe("ok");
    },
  );
  it("hace lecturas acotadas por cuenta y distingue funciones no disponibles", async () => {
    const p = provider(),
      read = await verifyProviders([p], { now });
    expect(p.getPerformance).toHaveBeenCalledWith(
      { account_id: account.account_id, date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(read.operations.filter((r) => r.state === "not_supported").map((r) => r.section)).toEqual([
      "budgets",
      "delivery",
    ]);
    expect(read.performance[0]).toMatchObject({ spend: 0, conversions: null });
  });
  it("no consulta una plataforma sin configurar o con permisos denegados", async () => {
    const unset = provider();
    unset.isConfigured = () => false;
    const denied = provider();
    denied.status = async () => ({
      ...(await provider().status()),
      state: "access_required",
      last_error: { code: "ACCESS_REQUIRED", message: "private-body", at: now.toISOString() },
    });
    const read = await verifyProviders([unset, denied], { now });
    expect(unset.listAccounts).not.toHaveBeenCalled();
    expect(denied.listAccounts).not.toHaveBeenCalled();
    expect(read.operations.map((r) => r.state)).toContain("not_configured");
    expect(read.operations.find((r) => r.section === "access")?.codes).toEqual(["ACCESS_REQUIRED"]);
  });
  it("un fallo de presupuestos conserva rendimiento y no registra el cuerpo del error", async () => {
    const p = provider();
    p.listBudgets = async () => {
      throw new Error("synthetic-private-auth-body");
    };
    const read = await verifyProviders([p], { now });
    expect(read.operations.find((r) => r.section === "budgets")).toMatchObject({ state: "error", codes: ["UNKNOWN"] });
    expect(read.performance).toHaveLength(1);
    expect(JSON.stringify(read.operations)).not.toContain("synthetic-private-auth-body");
  });
  it("vacío no se transforma en gasto cero; un aviso conserva el estado parcial", async () => {
    const p = provider();
    p.getPerformance = async (_q, options) => {
      options?.onWarning?.(new ApiError("ACCESS_DENIED"));
      return [];
    };
    const read = await verifyProviders([p], { now });
    expect(read.performance).toEqual([]);
    expect(read.operations.find((r) => r.section === "performance")).toMatchObject({ state: "partial", count: 0 });
    p.getPerformance = async () => [];
    expect((await verifyProviders([p], { now })).operations.find((r) => r.section === "performance")?.state).toBe(
      "empty",
    );
  });
  it("cuentas omitidas por límite son explícitas y los MCC no se reportan como cuentas de gasto", async () => {
    const p = provider();
    p.listAccounts = async () => [
      account,
      { ...account, account_id: "222" },
      { ...account, account_id: "333", is_manager: true },
    ];
    const read = await verifyProviders([p], { now, maxAccounts: 1 });
    expect(read.operations.filter((r) => r.section === "coverage")).toEqual([
      expect.objectContaining({ account_id: "222", state: "skipped", codes: ["ACCOUNT_LIMIT"] }),
    ]);
    expect(p.getPerformance).toHaveBeenCalledTimes(1);
  });
  it("una selección inexistente no termina consultando todas las cuentas", async () => {
    const p = provider(),
      read = await verifyProviders([p], { now, accounts: { tiktok: ["unknown"] } });
    expect(read.operations.find((r) => r.section === "selection")).toMatchObject({
      state: "error",
      codes: ["ACCOUNT_NOT_FOUND"],
    });
    expect(p.getPerformance).not.toHaveBeenCalled();
  });
  it("sin zona bloquea solo rendimiento; --fecha explícita es una elección trazable", async () => {
    const p = provider();
    p.listAccounts = async () => [{ ...account, timezone: null }];
    const read = await verifyProviders([p], { now });
    expect(p.getPerformance).not.toHaveBeenCalled();
    expect(read.operations.find((r) => r.section === "performance")?.state).toBe("error");
    await verifyProviders([p], { now, date: "2026-09-28" });
    expect(p.getPerformance).toHaveBeenCalledTimes(1);
  });
  it("aborta el transporte cuando vence el plazo", async () => {
    const p = provider();
    let aborted = false;
    p.getPerformance = (_q, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new ApiError("PROVIDER_TIMEOUT"));
          },
          { once: true },
        ),
      );
    const read = await verifyProviders([p], { now, timeoutMs: 10 });
    expect(aborted).toBe(true);
    expect(read.operations.find((r) => r.section === "performance")?.codes).toEqual(["PROVIDER_TIMEOUT"]);
  });
  it.each(["account", "date"])("rechaza rendimiento de otro ámbito: %s", async (kind) => {
    const p = provider();
    p.getPerformance = async () => [
      { ...performance, ...(kind === "account" ? { account_id: "222" } : { date: "2026-09-30" }) },
    ];
    const read = await verifyProviders([p], { now });
    expect(read.performance).toEqual([]);
    expect(read.operations.find((r) => r.section === "performance")?.codes).toEqual(["PROVIDER_ERROR"]);
  });
  it("límites de filas conservan las secciones previas y marcan el fallo", async () => {
    const p = provider();
    p.getPerformance = async () => [performance, performance];
    const read = await verifyProviders([p], { now, maxRows: 1 });
    expect(read.accounts).toHaveLength(1);
    expect(read.performance).toHaveLength(0);
    expect(read.operations.find((r) => r.section === "performance")?.state).toBe("error");
  });
  it("el Excel conserva IDs de 64 bits, celdas nulas y texto seguro; omite raw_metrics y errores originales", async () => {
    const read = await verifyProviders([provider()], { now });
    read.statuses[0]!.last_error = { code: "ACCESS_DENIED", message: "synthetic-private-error", at: now.toISOString() };
    read.performance[0]!.raw_metrics = {
      ...read.performance[0]!.raw_metrics,
      primary_conversion_metric: "complete_payment",
      primary_conversion_scope: "account",
    };
    const directory = await mkdtemp(join(tmpdir(), "uaa-verification-"));
    const path = await writeWorkbook("fixture", verificationSheets(read), join(directory, "read.xlsx"));
    const xml = Object.values(unzipSync(await readFile(path)))
      .map((bytes) => strFromU8(bytes))
      .join("\n");
    expect(xml).toContain(account.account_id);
    expect(xml).toContain('t="inlineStr"');
    expect(xml).not.toContain("<f>");
    expect(xml).toContain("complete_payment");
    expect(xml).toContain("TIKTOK_PURCHASE_VALUE_UNVERIFIED");
    for (const value of ["synthetic-private-marker", "signed-private-marker", "synthetic-private-error"])
      expect(xml).not.toContain(value);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(writeWorkbook("fixture", verificationSheets(read), path)).rejects.toMatchObject({ code: "EEXIST" });
  });
  it("valida fechas y opciones antes de llamar proveedores", async () => {
    const p = provider();
    p.status = vi.fn(p.status);
    await expect(verifyProviders([p], { date: "2026-02-30" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(p.status).not.toHaveBeenCalled();
    expect(
      verificationArgs(["--proveedores", "tiktok,meta", "--cuentas", "meta:act_111,222", "--fecha", "2026-09-29"]),
    ).toMatchObject({ providers: ["tiktok", "meta"], accounts: { meta: ["111", "222"] } });
    expect(() => verificationArgs(["--salida", ".env"])).toThrow();
    expect(() => verificationArgs(["--proveedores", "unknown"])).toThrow();
    expect(
      verificationArgs(["--proveedores", "spotify", "--cuentas", "spotify:f154306e-82ce-4c8b-a772-09140c1a24c6"])
        .accounts.spotify,
    ).toEqual(["f154306e-82ce-4c8b-a772-09140c1a24c6"]);
  });
});

describe("verificador: rotación privada completa", () => {
  it("guarda el último token en .env y en el almacén sin perder otras líneas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uaa-rotation-")),
      env = join(dir, ".env"),
      store = join(dir, "tokens.env");
    await writeFile(env, "META_ACCESS_TOKEN=synthetic-preserved\n", { mode: 0o600 });
    const writer = rotationWriter(env, store);
    writer.record("MICROSOFT_ADS_REFRESH_TOKEN", "synthetic-old");
    writer.record("MICROSOFT_ADS_REFRESH_TOKEN", "synthetic-new");
    writer.record("SPOTIFY_ADS_REFRESH_TOKEN", "synthetic-spotify");
    await writer.flush();
    for (const path of [env, store]) {
      const text = await readFile(path, "utf8");
      expect(text).toContain("synthetic-new");
      expect(text).not.toContain("synthetic-old");
      expect(text).toContain("synthetic-spotify");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect(await readFile(env, "utf8")).toContain("synthetic-preserved");
    expect((await readdir(dir)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
  it("fallo de persistencia se comunica sin imprimir el token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uaa-rotation-error-")),
      bad = join(dir, "directory");
    await mkdir(bad);
    const writer = rotationWriter(bad);
    writer.record("SPOTIFY_ADS_REFRESH_TOKEN", "synthetic-private");
    await expect(writer.flush()).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await writer.flush();
  });
});
