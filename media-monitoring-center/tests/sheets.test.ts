import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { invalidate } from "@/lib/data/cache";
import { parseSheetsMapping, type SheetsMapping } from "@/lib/sheets/mapping";
import { dataslayerStatus, SheetsDataSource } from "@/lib/sheets/sheets-source";
import { normId, parseDateLoose, parseHourLoose, parseNumberLoose, rowsFromRange, usesDecimalComma, type Cell } from "@/lib/sheets/parse";
import type { SheetsInfo, SheetsReader } from "@/lib/sheets/reader";

const TZ = "America/Mexico_City"; // UTC-6
const SHEET_TZ = "America/Bogota"; // UTC-5, como la hoja de Dataslayer
const NOW = new Date("2026-09-28T20:30:00Z"); // 14:30 en CDMX (lunes)

const mapping: SheetsMapping = parseSheetsMapping(readFileSync(path.join(process.cwd(), "config", "sheets.mapping.json"), "utf8")).mapping!;

const GOOGLE_HEAD = ["Date", "Account", "Account ID", "Advertising channel type", "Campaign", "Campaign ID", "Impressions", "Clicks", "Conversions", "Cost"];
const CONV_HEAD = ["Date", "Account ID", "Account", "Campaign", "Campaign ID", "Advertising channel type", "Conversion Action Name", "Conversions"];
const META_HEAD = ["Date", "Account id", "Account name", "Campaign id", "Campaign name", "Objective", "Impressions", "Clicks", "On Facebook Leads", "Messaging conversations started", "Compras Offline Web (Inbound)", "On-Facebook Purchase actions", "Total Cost"];
const CONTROL_HEAD = ["Query UUID", "Sheet name", "Range address", "Created", "Updated", "Last status", "Data source"];

function baseTabs(): Record<string, Cell[][]> {
  const hourly: Cell[][] = [["Date", "Hour of day", "Account ID", "Account", "Cost", "Impressions", "Clicks", "Conversions"]];
  // Curva real de la cuenta: nada de madrugada, fuerte al mediodía.
  const curve = [0, 0, 0, 0, 0, 0, 1, 2, 4, 6, 8, 9, 9, 8, 7, 7, 7, 6, 5, 4, 3, 2, 1, 1];
  for (let h = 0; h < 24; h++) hourly.push(["2026-09-21", h, 7367928294, "izzi - Ofertas", curve[h] * 10, curve[h] * 100, curve[h] * 5, curve[h]]);
  for (let h = 0; h <= 14; h++) hourly.push(["2026-09-28", h, 7367928294, "izzi - Ofertas", curve[h] * 8, curve[h] * 90, curve[h] * 4, curve[h]]);
  return {
    "Google | General": [
      GOOGLE_HEAD,
      ["2026-09-21", "izzi - Ofertas", 7367928294, "SEARCH", "MXSUR - CPC Manual", 111, 10000, 500, 20, 1000],
      ["2026-09-21", "izzi - Ofertas", 7367928294, "PERFORMANCE_MAX", "Performance Max | 2026 | Descuentos", 222, 4000, 100, 5, 500],
      ["2026-09-28", "izzi - Ofertas", 7367928294, "SEARCH", "MXSUR - CPC Manual", 111, 4000, 200, 8, 400],
      ["2026-09-28", "izzi - Ofertas", 7367928294, "PERFORMANCE_MAX", "Performance Max | 2026 | Descuentos", 222, 1500, 40, 2, 200],
    ],
    "Google Conversiones": [
      CONV_HEAD,
      ["2026-09-28", 7367928294, "izzi - Ofertas", "MXSUR - CPC Manual", 111, "SEARCH", "MCC_Offline_Purchase", 3],
      ["2026-09-28", 7367928294, "izzi - Ofertas", "MXSUR - CPC Manual", 111, "SEARCH", "MCC_Offline_Purchase", 3],
      ["2026-09-28", 7367928294, "izzi - Ofertas", "MXSUR - CPC Manual", 111, "SEARCH", "MCC_Offline_Lead_Contact", 5],
      ["2026-09-28", 7367928294, "izzi - Ofertas", "MXSUR - CPC Manual", 111, "SEARCH", "Calls from ads", 7],
    ],
    Meta: [META_HEAD, ["2026-09-28", 801573051220234, "MXN - izzi 1", 120244980534460700, "WhatsApp//ABRIL 100//izzi telecom - Ventas", "OUTCOME_SALES", 110645, 723, 3, 5, 2, 1, "2.472"]],
    TikTok: [["Date", "Advertiser ID", "Advertiser name", "Campaign ID", "Campaign name", "Campaign objective type", "Impressions", "Clicks", "Conversions", "Cost"]],
    Bing: [["Date", "Account ID", "Account Name", "Campaign ID", "Campaign Name", "Impressions", "Clicks", "Conversions", "Cost"]],
    Spotify: [["Date", "Campaign ID", "Campaign Name", "Impressions On Spotify", "Clicks", "Frequency", "Spend"], ["2026-09-28", "32a59da2", "Listas de Reproducción", 5051, 22, 1, 235.4]],
    "Google | Hora": hourly,
    DataslayerQueries: [
      CONTROL_HEAD,
      ["a", "Google | General'", "$A$1:$J$5", "2026-03-05", "2026-09-28 15:10:00", "Refreshed successfully", "ads"],
      ["b", "Google Conversiones'", "$A$1:$H$5", "2026-03-05", "2026-09-28 15:11:00", "Refreshed successfully", "ads"],
      ["c", "Meta", "$A$1:$M$2", "2026-07-24", "2026-09-28 15:12:00", "Error: token expired", "facebook"],
      ["d", "Spotify", "$A$1:$G$2", "2026-03-05", "2026-09-28 15:13:00", "Refreshed successfully", "spotify"],
    ],
    Presupuestos: [
      ["Mes", "Plataforma", "Cuenta", "Monto"],
      ["2026-09", "Google", "izzi - Ofertas", 510000],
    ],
  };
}

class MemoryReader implements SheetsReader {
  readonly kind = "fixture" as const;
  constructor(public tabs: Record<string, Cell[][]>) {}
  async info(): Promise<SheetsInfo> {
    return { title: "Monitoreo | Big Query", timeZone: SHEET_TZ, locale: "es_CO", sheets: Object.keys(this.tabs) };
  }
  async batchGet(_id: string, ranges: string[]) {
    return ranges.map((r) => this.tabs[r.replace(/^'/, "").replace(/'![A-Z0-9:]+$/i, "").replace(/''/g, "'")] ?? []);
  }
}

let seq = 0;
function source(tabs = baseTabs()) {
  const reader = new MemoryReader(tabs);
  const id = `test-spreadsheet-${++seq}-aaaaaaaaaaaaaaaa`;
  return { reader, src: new SheetsDataSource({ mapping, spreadsheetId: id, timezone: TZ, reader, clock: () => NOW }) };
}

const sum = (xs: Array<number | null>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

describe("lectura tolerante de celdas", () => {
  it("números con formato de la hoja y celdas vacías como NULL", () => {
    expect(parseNumberLoose("$1.315,74", true)).toBeCloseTo(1315.74);
    expect(parseNumberLoose("1,234.56")).toBeCloseTo(1234.56);
    expect(parseNumberLoose("12,76", true)).toBeCloseTo(12.76);
    expect(parseNumberLoose("110.645", true)).toBe(110645);
    expect(parseNumberLoose("23540%")).toBeCloseTo(235.4);
    expect(parseNumberLoose("")).toBeNull();
    expect(parseNumberLoose("N/A")).toBeNull();
    expect(parseNumberLoose("#VALUE!")).toBeNull();
    expect(parseNumberLoose(0)).toBe(0);
  });
  it("fechas, horas, IDs y rangos", () => {
    expect(parseDateLoose("2026-09-28", TZ)).toBe("2026-09-28");
    expect(parseDateLoose(20260928, TZ)).toBe("2026-09-28");
    expect(parseDateLoose(45658, TZ)).toBe("2025-01-01");
    expect(parseHourLoose(13)).toBe(13);
    expect(parseHourLoose("00:00:00 - 00:59:59")).toBe(0);
    expect(parseHourLoose("2026-09-28 13:00:00")).toBe(13);
    expect(parseHourLoose("1 PM")).toBe(13);
    expect(normId("736-792-8294")).toBe(normId(7367928294));
    expect(normId("act_801573051220234")).toBe("801573051220234");
    expect(rowsFromRange("$A$1:$J$6816")).toBe(6815);
    expect(usesDecimalComma("es_CO")).toBe(true);
    expect(usesDecimalComma("es_MX")).toBe(false);
  });
  it("estados de Dataslayer", () => {
    expect(dataslayerStatus("Refreshed successfully")).toBe("OK");
    expect(dataslayerStatus("Error: token expired")).toBe("ERROR");
    expect(dataslayerStatus("Refreshing…")).toBe("EJECUTANDO");
  });
});

describe("hoja de Dataslayer como fuente de datos", () => {
  beforeEach(() => invalidate("sheets:"));

  it("el mapeo de config/ es válido y solo monitorea las plataformas de la hoja", () => {
    expect(mapping).not.toBeNull();
    const { src } = source();
    expect(src.platforms()).toEqual(["google", "meta", "tiktok", "microsoft", "spotify"]);
  });

  it("une Google General con Conversiones (solo eventos offline válidos) y suma las columnas de Meta", async () => {
    const { src } = source();
    const daily = await src.getDaily({ from: "2026-09-28", to: "2026-09-28", level: "campaign" });
    const c111 = daily.find((r) => r.campaignId === "111")!;
    expect(c111.metrics.spend).toBe(400);
    expect(c111.metrics.sales).toBe(3); // la fila repetida se ignora
    expect(c111.metrics.leads).toBe(5); // "Calls from ads" no se usa
    expect(daily.find((r) => r.campaignId === "222")!.metrics.sales).toBeNull(); // sin dato ≠ cero
    const meta = daily.find((r) => r.platform === "meta")!;
    expect(meta.metrics.spend).toBe(2472); // texto con separador de miles de la hoja (es_CO)
    expect(meta.metrics.conversions).toBe(3); // Compras Offline Web + On-Facebook Purchase
    expect(daily.find((r) => r.platform === "spotify")!.accountId).toBe("spotify-izzi-mxn");
    const q = await src.getDataQuality("2026-09-28");
    expect(q.find((x) => x.platform === "google")!.duplicateRows).toBe(1);
  });

  it("reparte el diario por hora con la curva real de la cuenta, sin cambiar el total", async () => {
    const { src } = source();
    const rows = await src.getHourly({ dates: ["2026-09-28", "2026-09-21"], level: "campaign" });
    const c111Today = rows.filter((r) => r.campaignId === "111" && r.date === "2026-09-28");
    expect(sum(c111Today.map((r) => r.metrics.spend))).toBeCloseTo(400);
    expect(sum(c111Today.map((r) => r.metrics.sales))).toBeCloseTo(3);
    expect(c111Today.find((r) => r.hour === 3)!.metrics.spend).toBe(0); // la cuenta no gasta de madrugada
    expect(Math.max(...c111Today.map((r) => r.hour))).toBe(14); // hasta la actualización (14:10)
    const past = rows.filter((r) => r.campaignId === "111" && r.date === "2026-09-21");
    expect(past).toHaveLength(24);
    expect(sum(past.map((r) => r.metrics.spend))).toBeCloseTo(1000);
    const platform = await src.getHourly({ dates: ["2026-09-28"], level: "platform", platforms: ["google"] });
    expect(sum(platform.map((r) => r.metrics.spend))).toBeCloseTo(600);
  });

  it("una campaña que gastó ayer y hoy no aparece en la hoja actualizada gastó cero (no NULL)", async () => {
    const tabs = baseTabs();
    tabs["Google | General"].push(["2026-09-27", "izzi - Ofertas", 7367928294, "SEARCH", "Genéricas | Hogar", 333, 900, 30, 2, 250]);
    const { src } = source(tabs);
    const rows = await src.getHourly({ dates: ["2026-09-28"], level: "campaign", platforms: ["google"] });
    const stopped = rows.filter((r) => r.campaignId === "333");
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped.every((r) => r.metrics.spend === 0)).toBe(true);
    expect((await src.getCatalog()).campaigns.find((c) => c.id === "333")?.status).toBe("ACTIVE");
  });

  it("sin pestaña por hora usa la curva típica y lo avisa en el control de ejecución", async () => {
    const { src } = source();
    const meta = await src.getHourly({ dates: ["2026-09-28"], level: "campaign", platforms: ["meta"] });
    expect(sum(meta.map((r) => r.metrics.spend))).toBeCloseTo(2472);
    expect(await src.estimatedToday()).toEqual(["meta", "spotify"]);
    const exec = await src.getExecutionControl(NOW);
    expect(exec.find((r) => r.id === "curve-meta")?.status).toBe("PARCIAL");
    expect(exec.find((r) => r.id === "curve-google")).toBeUndefined();
  });

  it("frescura y estado desde DataslayerQueries (hora de la hoja convertida a la de negocio)", async () => {
    const { src } = source();
    const fresh = await src.getFreshness(NOW);
    const google = fresh.find((f) => f.platform === "google" && f.accountId === null)!;
    expect(google.lastDataAt).toBe("2026-09-28T20:10:00.000Z"); // 15:10 Bogotá = 14:10 CDMX
    expect(google.lastSyncStatus).toBe("SUCCESS");
    expect(fresh.find((f) => f.platform === "google" && f.accountId === "7367928294")?.lastDataAt).toBe(google.lastDataAt);
    const meta = fresh.find((f) => f.platform === "meta" && f.accountId === null)!;
    expect(meta.lastSyncStatus).toBe("FAILED");
    expect(meta.lastError).toContain("token expired");
    const exec = await src.getExecutionControl(NOW);
    expect(exec.find((r) => r.step === "Dataslayer · Google | General")?.status).toBe("OK");
    expect(exec.find((r) => r.step === "Dataslayer · Meta")?.status).toBe("ERROR");
  });

  it("a mitad de una actualización conserva la última lectura completa", async () => {
    const tabs = baseTabs();
    const big: Cell[][] = [META_HEAD];
    for (let i = 0; i < 40; i++) big.push(["2026-09-28", 801573051220234, "MXN - izzi 1", 1000 + i, `Campaña ${i}`, "OUTCOME_SALES", 1000, 10, 0, 0, 0, 0, 100]);
    tabs.Meta = big;
    const { src, reader } = source(tabs);
    expect((await src.getDaily({ from: "2026-09-28", to: "2026-09-28", level: "platform", platforms: ["meta"] }))[0].metrics.spend).toBe(4000);
    reader.tabs.Meta = [META_HEAD]; // Dataslayer vació la pestaña mientras la reescribe
    invalidate("sheets:dataset");
    expect((await src.getDaily({ from: "2026-09-28", to: "2026-09-28", level: "platform", platforms: ["meta"] }))[0].metrics.spend).toBe(4000);
    const exec = await src.getExecutionControl(NOW);
    expect(exec.find((r) => r.step === "Dataslayer · Meta")?.status).toBe("EJECUTANDO");
  });

  it("catálogo, presupuestos y pestañas faltantes", async () => {
    const tabs = baseTabs();
    delete tabs.Bing;
    const { src } = source(tabs);
    const catalog = await src.getCatalog();
    expect(catalog.accounts.find((a) => a.id === "7367928294")?.name).toBe("izzi - Ofertas");
    const c222 = catalog.campaigns.find((c) => c.id === "222")!;
    expect(c222.status).toBe("ACTIVE");
    expect(c222.sourceType).toBe("PERFORMANCE_MAX");
    const budgets = await src.getBudgets("2026-09");
    expect(budgets).toEqual([{ month: "2026-09", level: "account", platform: "google", accountId: "7367928294", campaignId: null, amount: 510000, currency: "MXN" }]);
    const exec = await src.getExecutionControl(NOW);
    expect(exec.find((r) => r.id === "missing-bing")?.status).toBe("ERROR");
    expect((await src.summary()).errors[0]).toContain("Bing");
  });
});
