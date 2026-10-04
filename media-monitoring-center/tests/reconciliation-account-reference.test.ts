import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accountColumnsSchema, buildAccountReference, importAccountReferenceRows, normalizeAccountId, type AccountImportOptions } from "@/lib/reconciliation/account-reference-import";
import { parseReference } from "@/lib/reconciliation/reconcile";
import { mappingSchema } from "@/lib/unified/schema";

const mapping = mappingSchema.parse({ version: 1, accounts: [
  { platform: "google", accountId: "8779536058", brand: "izzi", currency: "MXN" },
  { platform: "google", accountId: "7771629164", brand: "izzi", currency: "USD" },
  { platform: "google", accountId: "1970842746", brand: "sky", currency: "MXN" },
  { platform: "microsoft", accountId: "138689064", brand: "izzi", currency: "MXN" },
  { platform: "spotify", accountId: "f154306e-82ce-4c8b-a772-09140c1a24c6", brand: "izzi", currency: "MXN" },
] });
const googleColumns = { version: 1, columns: { accountId: "Customer ID", currency: "Currency code", date: null, spend: "Cost", impressions: "Impr.", clicks: "Clicks" } };
const google: AccountImportOptions = { platform: "google", mapping, date: "2026-10-01", timezone: "America/Mexico_City", decimal: ".", thousands: ",", delimiter: "," };
const googleCsv = [
  "Untitled report", "\"October 1, 2026 - October 1, 2026\"",
  "Account name,Customer ID,Campaign,Campaign ID,Currency code,Cost,Impr.,Clicks",
  "izzi – Performance AO - mxn,877-953-6058,Campaña A,1,MXN,99906.17,\"46,803\",\"4,514\"",
  "izzi – Performance AO - mxn,877-953-6058,Campaña B,2,MXN,0.83,\"2,539,093\",289",
  "izzi - campañas,777-162-9164,Campaña C,3,USD,7.43,284,33",
  "Sky,197-084-2746,Campaña Sky,4,MXN,10.00,10,1",
  "Total: Account,--,,,,100.00,10,1",
].join("\r\n");

describe("referencia cuenta/día desde un export de la interfaz", () => {
  it("suma por cuenta del mapeo izzi, omite y cuenta otras marcas y deja la moneda del mapeo", () => {
    const result = importAccountReferenceRows(googleCsv, googleColumns, google);
    expect(result).toMatchObject({ sourceRows: 3, skippedRows: 1, skippedAccounts: 1 });
    expect(result.rows).toEqual([
      expect.objectContaining({ platform: "google", accountId: "7771629164", currency: "USD", spend: 7.43, impressions: 284, clicks: 33, timezone: "America/Mexico_City", granularity: "daily" }),
      expect.objectContaining({ accountId: "8779536058", currency: "MXN", spend: 99907, impressions: 2585896, clicks: 4803 }),
    ]);
    const reference = buildAccountReference(result.rows, { date: "2026-10-01", exportedAt: "2026-10-04T22:30:00Z" });
    expect(parseReference(reference)).toMatchObject({ origin: "ADS_MANAGER", scope: "ALL_CAMPAIGNS", from: "2026-10-01", to: "2026-10-01" });
  });
  it("normaliza IDs entre corchetes o con guiones y lee exports de una sola cuenta con --cuenta", () => {
    expect(normalizeAccountId("microsoft", "[138689064]")).toBe("138689064");
    expect(normalizeAccountId("google", " 877-953-6058 ")).toBe("8779536058");
    const microsoft = ["Report Name: Nuevo informe", "Time Zone: (GMT) Hora universal coordinada", "", "Id. de la cuenta,Nombre de la campaña,Gasto,Impresiones,Clics", "[138689064],BAJIO,302.43,5242,138", "[138689064],SUR,692.99,16799,253", "Total,-,-,22041,391", "©2026 Microsoft Corporation. All rights reserved."].join("\n");
    const ms = importAccountReferenceRows(microsoft, { version: 1, columns: { accountId: "Id. de la cuenta", currency: null, date: null, spend: "Gasto", impressions: "Impresiones", clicks: "Clics" } }, { ...google, platform: "microsoft", timezone: "UTC" });
    expect(ms.rows).toEqual([expect.objectContaining({ accountId: "138689064", spend: 995.42, impressions: 22041, clicks: 391, timezone: "UTC" })]);
    const spotify = importAccountReferenceRows("Date,Campaign Name,Impressions,Clicks,Spend\n2026-10-01,izzi tv 2026,259,13,0\n", { version: 1, columns: { accountId: null, currency: null, date: "Date", spend: "Spend", impressions: "Impressions", clicks: "Clicks" } }, { ...google, platform: "spotify", timezone: "UTC", accountId: "f154306e-82ce-4c8b-a772-09140c1a24c6" });
    expect(spotify.rows).toEqual([expect.objectContaining({ accountId: "f154306e-82ce-4c8b-a772-09140c1a24c6", spend: 0, impressions: 259, clicks: 13 })]);
  });
  it("una celda desconocida deja desconocido el total de la cuenta, nunca cero", () => {
    const result = importAccountReferenceRows(googleCsv.replace("0.83,", "--,"), googleColumns, google);
    expect(result.rows.find(r => r.accountId === "8779536058")).toMatchObject({ spend: null, impressions: 2585896 });
  });
  it("rechaza otra moneda, otra fecha, celdas inválidas, cabeceras ausentes y declaraciones de cuenta ambiguas", () => {
    expect(() => importAccountReferenceRows(googleCsv.replace("3,USD", "3,MXN"), googleColumns, google)).toThrow(/ACCOUNT_EXPORT_CURRENCY_MISMATCH_6/);
    // A mapped day column must carry the declared date on every izzi row.
    expect(() => importAccountReferenceRows(googleCsv, { version: 1, columns: { ...googleColumns.columns, date: "Account name" } }, google)).toThrow(/ACCOUNT_EXPORT_DATE_MISMATCH_4/);
    expect(() => importAccountReferenceRows(googleCsv.replace("99906.17", "$99,906.17"), googleColumns, google)).toThrow(/ACCOUNT_EXPORT_INVALID_CELL_4/);
    expect(() => importAccountReferenceRows(googleCsv, { version: 1, columns: { ...googleColumns.columns, spend: "Costo" } }, google)).toThrow(/ACCOUNT_EXPORT_HEADERS_NOT_FOUND/);
    expect(() => importAccountReferenceRows(googleCsv, { version: 1, columns: { ...googleColumns.columns, accountId: null } }, google)).toThrow(/INVALID_ACCOUNT_OPTIONS/);
    expect(() => importAccountReferenceRows(googleCsv, googleColumns, { ...google, accountId: "8779536058" })).toThrow(/INVALID_ACCOUNT_OPTIONS/);
    expect(() => importAccountReferenceRows(googleCsv, { version: 1, columns: { ...googleColumns.columns, accountId: null } }, { ...google, accountId: "1970842746" })).toThrow(/ACCOUNT_NOT_IN_IZZI_MAPPING/);
    expect(() => importAccountReferenceRows(googleCsv, { version: 1, columns: { ...googleColumns.columns, clicks: "Cost" } }, google)).toThrow(/INVALID_ACCOUNT_COLUMNS/);
  });
  it("anexa plataformas en una sola referencia, conserva la exportación más temprana y rechaza repetidos o rangos distintos", () => {
    const g = importAccountReferenceRows(googleCsv, googleColumns, google).rows;
    const first = buildAccountReference(g, { date: "2026-10-01", exportedAt: "2026-10-04T22:30:00Z" });
    const ms = importAccountReferenceRows("Id. de la cuenta,Gasto,Impresiones,Clics\n[138689064],10.5,100,3\n", { version: 1, columns: { accountId: "Id. de la cuenta", currency: null, date: null, spend: "Gasto", impressions: "Impresiones", clicks: "Clics" } }, { ...google, platform: "microsoft", timezone: "UTC" }).rows;
    const merged = buildAccountReference(ms, { date: "2026-10-01", exportedAt: "2026-10-05T01:00:00Z" }, first);
    expect(merged.rows.map(r => `${r.platform}/${r.accountId}`)).toEqual(["google/7771629164", "google/8779536058", "microsoft/138689064"]);
    expect(merged.exportedAt).toBe("2026-10-04T22:30:00Z");
    expect(() => buildAccountReference(g, { date: "2026-10-01", exportedAt: "2026-10-05T01:00:00Z" }, first)).toThrow(/DUPLICATE_OR_INVALID_ACCOUNT_REFERENCE/);
    expect(() => buildAccountReference(ms, { date: "2026-10-02", exportedAt: "2026-10-05T01:00:00Z" }, first)).toThrow(/REFERENCE_RANGE_MISMATCH/);
  });
  it("incluye mapas de columnas de ejemplo válidos", () => {
    for (const name of ["google", "microsoft"]) expect(accountColumnsSchema.safeParse(JSON.parse(readFileSync(new URL(`../config/conciliacion-columnas.${name}.example.json`, import.meta.url), "utf8"))).success).toBe(true);
  });
});
