import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { invalidate } from "@/lib/data/cache";
import { parseSheetsMapping, type SheetsMapping } from "@/lib/sheets/mapping";
import { dataslayerStatus, readWindow, SheetsDataSource } from "@/lib/sheets/sheets-source";
import { columnLetter, normId, parseA1, parseDateLoose, parseHourLoose, parseNumberLoose, rowsFromRange, sliceRanges, usesDecimalComma, type Cell } from "@/lib/sheets/parse";
import type { BatchGetOptions, SheetsInfo, SheetsReader } from "@/lib/sheets/reader";
import { harmonizeIds, parseTab, slugId } from "@/lib/sheets/transform";

const TZ = "America/Mexico_City"; // UTC-6
const SHEET_TZ = "America/Bogota"; // UTC-5, como la hoja de Dataslayer
const NOW = new Date("2026-09-28T20:30:00Z"); // 14:30 en CDMX (lunes)

const mapping: SheetsMapping = parseSheetsMapping(readFileSync(path.join(process.cwd(), "config", "sheets.mapping.json"), "utf8")).mapping!;

const GOOGLE_HEAD = ["Date", "Account", "Campaign", "Currency", "Impressions", "Clicks", "CTR", "Cost", "CPC", "CPM", "Daily Budget", "Engagements", "Conversions"];
const CONV_HEAD = ["Date", "Account", "Campaign", "Advertising channel type", "Conversion Action Name", "Conversions"];
const META_HEAD = ["Date", "Account name", "Campaign name", "Objective", "Account Currency", "Impressions", "Clicks", "On Facebook Leads", "Messaging conversations started", "Cost per New Conversation started", "Reach", "20s Calls Placed", "Offline purchases", "Compras Offline Web (Inbound)", "On-Facebook Purchase actions", "Total Cost"];
const CONTROL_HEAD = ["Query UUID", "Sheet name", "Range address", "Created", "Updated", "Last status", "Data source"];

/** Número de serie de Sheets (así llegan las fechas con UNFORMATTED_VALUE). */
const serial = (d: string) => (Date.parse(`${d}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;

// La hoja no trae IDs: las llaves se arman con el nombre de la cuenta y de la campaña.
const ACC = "google-izzi-ofertas";
const C111 = `${ACC}-mxsur-cpc-manual`;
const C222 = `${ACC}-performance-max-2026-descuentos`;

function metaRow(date: string, account: string, campaign: string, spend: number | string, extra: Partial<Record<"leads" | "wa" | "calls" | "inbound" | "ofb", number>> = {}): Cell[] {
  return [date, account, campaign, "OUTCOME_SALES", "MXN", 110645, 723, extra.leads ?? 3, extra.wa ?? 5, 0, 90000, extra.calls ?? 0, 0, extra.inbound ?? 2, extra.ofb ?? 1, spend];
}

function baseTabs(): Record<string, Cell[][]> {
  const hourly: Cell[][] = [["Date", "Hour of day", "Account", "Cost", "Impressions", "Clicks", "Conversions"]];
  // Curva real de la cuenta: nada de madrugada, fuerte al mediodía.
  const curve = [0, 0, 0, 0, 0, 0, 1, 2, 4, 6, 8, 9, 9, 8, 7, 7, 7, 6, 5, 4, 3, 2, 1, 1];
  for (let h = 0; h < 24; h++) hourly.push(["2026-09-21", h, "izzi - Ofertas", curve[h] * 10, curve[h] * 100, curve[h] * 5, curve[h]]);
  for (let h = 0; h <= 14; h++) hourly.push(["2026-09-28", h, "izzi - Ofertas", curve[h] * 8, curve[h] * 90, curve[h] * 4, curve[h]]);
  const g = (date: string, campaign: string, cost: number, impressions: number, clicks: number, conv: number): Cell[] => [serial(date), "izzi - Ofertas", campaign, "MXN", impressions, clicks, 0.05, cost, 1, 10, 15000, 0, conv];
  return {
    // Dataslayer dejó un espacio al final del nombre de la pestaña.
    "Google ": [
      GOOGLE_HEAD,
      g("2026-09-21", "MXSUR - CPC Manual", 1000, 10000, 500, 20),
      g("2026-09-21", "Performance Max | 2026 | Descuentos", 500, 4000, 100, 5),
      g("2026-09-28", "MXSUR - CPC Manual", 400, 4000, 200, 8),
      g("2026-09-28", "Performance Max | 2026 | Descuentos", 200, 1500, 40, 2),
    ],
    "Google Conversiones": [
      CONV_HEAD,
      ["2026-09-21", "izzi - Ofertas", "Performance Max | 2026 | Descuentos", "PERFORMANCE_MAX", "MCC_Lead_Click_Whatsapp", 4],
      ["2026-09-28", "izzi - Ofertas", "MXSUR - CPC Manual", "SEARCH", "MCC_Offline_Purchase", 3],
      ["2026-09-28", "izzi - Ofertas", "MXSUR - CPC Manual", "SEARCH", "MCC_Offline_Purchase", 3],
      ["2026-09-28", "izzi - Ofertas", "MXSUR - CPC Manual", "SEARCH", "MCC_Offline_Lead_Contact", 5],
      ["2026-09-28", "izzi - Ofertas", "MXSUR - CPC Manual", "SEARCH", "Calls from ads", 7],
      ["2026-09-28", "izzi - Ofertas", "MXSUR - CPC Manual", "SEARCH", "MCC_Lead_Click_Llamar", 40],
    ],
    Meta: [META_HEAD, metaRow("2026-09-28", "MXN - izzi 1", "WhatsApp//ABRIL 100//izzi telecom - Ventas", "2.472")],
    TikTok: [["Date", "Advertiser name", "Campaign name", "Currency", "Impressions", "Clicks", "CTR", "Results", "Cost per result", "Cost", "Conversions"]],
    Bing: [["Date", "Account Name", "Campaign Name", "Impressions", "Clicks", "CTR", "Conversions", "Cost per Conversion", "Cost"]],
    Spotify: [["Date", "Campaign Name", "Impressions On Spotify", "Reach", "Clicks", "CTR", "Frequency", "Spend"], ["2026-09-28", "Listas de Reproducción", 5051, 4000, 22, 0.4, 1, 235.4]],
    "Google | Hora": hourly,
    DataslayerQueries: [
      CONTROL_HEAD,
      // Consulta recién creada: Dataslayer aún no escribe "Updated" (se usa la hora de creación).
      ["a", "Google '", "$A$1:$M$5", "2026-09-28 15:10:00", "", "Created successfully", "ads"],
      ["b", "Google Conversiones'", "$A$1:$F$7", "2026-03-05", "2026-09-28 15:11:00", "Refreshed successfully", "ads"],
      ["c", "Meta", "$A$1:$P$2", "2026-07-24", "2026-09-28 15:12:00", "Error: token expired", "facebook"],
      ["d", "Spotify", "$A$1:$H$2", "2026-03-05", "2026-09-28 15:13:00", "Refreshed successfully", "spotify"],
    ],
    Presupuestos: [
      ["Mes", "Plataforma", "Cuenta", "Monto"],
      ["2026-09", "Google", "izzi - Ofertas", 510000],
    ],
  };
}

class MemoryReader implements SheetsReader {
  readonly kind = "fixture" as const;
  readonly requested: string[] = [];
  constructor(public tabs: Record<string, Cell[][]>) {}
  async info(): Promise<SheetsInfo> {
    return { title: "MONITOREO", timeZone: SHEET_TZ, locale: "es_CO", sheets: Object.keys(this.tabs) };
  }
  async batchGet(_id: string, ranges: string[], opts?: BatchGetOptions) {
    this.requested.push(...ranges);
    return sliceRanges(this.tabs, ranges, opts?.majorDimension);
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

  it("une Google con Conversiones (eventos offline válidos) y suma las columnas de Meta", async () => {
    const { src } = source();
    const daily = await src.getDaily({ from: "2026-09-28", to: "2026-09-28", level: "campaign" });
    const c111 = daily.find((r) => r.campaignId === C111)!;
    expect(c111.accountId).toBe(ACC);
    expect(c111.metrics.spend).toBe(400);
    expect(c111.metrics.sales).toBe(3); // la fila repetida se ignora
    expect(c111.metrics.leads).toBe(5); // los clics a WhatsApp o Llamar no son leads offline
    expect(c111.metrics.calls).toBe(7); // "Calls from ads"
    expect(daily.find((r) => r.campaignId === C222)!.metrics.sales).toBeNull(); // sin dato ≠ cero
    const meta = daily.find((r) => r.platform === "meta")!;
    expect(meta.metrics.spend).toBe(2472); // texto con separador de miles de la hoja (es_CO)
    expect(meta.metrics.conversions).toBe(3); // Compras Offline Web + On-Facebook Purchase
    expect(meta.accountId).toBe("meta-mxn-izzi-1");
    expect(daily.find((r) => r.platform === "spotify")!.accountId).toBe("spotify-izzi-mxn");
    const q = await src.getDataQuality("2026-09-28");
    expect(q.find((x) => x.platform === "google")!.duplicateRows).toBe(1);
  });

  it("reparte el diario por hora con la curva real de la cuenta, sin cambiar el total", async () => {
    const { src } = source();
    const rows = await src.getHourly({ dates: ["2026-09-28", "2026-09-21"], level: "campaign" });
    const c111Today = rows.filter((r) => r.campaignId === C111 && r.date === "2026-09-28");
    expect(sum(c111Today.map((r) => r.metrics.spend))).toBeCloseTo(400);
    expect(sum(c111Today.map((r) => r.metrics.sales))).toBeCloseTo(3);
    expect(c111Today.find((r) => r.hour === 3)!.metrics.spend).toBe(0); // la cuenta no gasta de madrugada
    expect(Math.max(...c111Today.map((r) => r.hour))).toBe(14); // hasta la actualización (14:10)
    const past = rows.filter((r) => r.campaignId === C111 && r.date === "2026-09-21");
    expect(past).toHaveLength(24);
    expect(sum(past.map((r) => r.metrics.spend))).toBeCloseTo(1000);
    const platform = await src.getHourly({ dates: ["2026-09-28"], level: "platform", platforms: ["google"] });
    expect(sum(platform.map((r) => r.metrics.spend))).toBeCloseTo(600);
  });

  it("una campaña que gastó ayer y hoy no aparece en la hoja actualizada gastó cero (no NULL)", async () => {
    const tabs = baseTabs();
    tabs["Google "].splice(3, 0, [serial("2026-09-27"), "izzi - Ofertas", "Genéricas | Hogar", "MXN", 900, 30, 0.03, 250, 8, 20, 1000, 0, 2]);
    const { src } = source(tabs);
    const rows = await src.getHourly({ dates: ["2026-09-28"], level: "campaign", platforms: ["google"] });
    const stopped = rows.filter((r) => r.campaignId === `${ACC}-genericas-hogar`);
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped.every((r) => r.metrics.spend === 0)).toBe(true);
    expect((await src.getCatalog()).campaigns.find((c) => c.id === `${ACC}-genericas-hogar`)?.status).toBe("ACTIVE");
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
    expect(google.lastDataAt).toBe("2026-09-28T20:10:00.000Z"); // creada 15:10 Bogotá = 14:10 CDMX
    expect(google.lastSyncStatus).toBe("SUCCESS");
    expect(fresh.find((f) => f.platform === "google" && f.accountId === ACC)?.lastDataAt).toBe(google.lastDataAt);
    const meta = fresh.find((f) => f.platform === "meta" && f.accountId === null)!;
    expect(meta.lastSyncStatus).toBe("FAILED");
    expect(meta.lastError).toContain("token expired");
    const exec = await src.getExecutionControl(NOW);
    expect(exec.find((r) => r.step === "Dataslayer · Google")?.status).toBe("OK");
    expect(exec.find((r) => r.step === "Dataslayer · Meta")?.status).toBe("ERROR");
  });

  it("a mitad de una actualización conserva la última lectura completa", async () => {
    const tabs = baseTabs();
    const big: Cell[][] = [META_HEAD];
    for (let i = 0; i < 40; i++) big.push(metaRow("2026-09-28", "MXN - izzi 1", `Campaña ${i}`, 100));
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
    expect(catalog.accounts.find((a) => a.id === ACC)?.name).toBe("izzi - Ofertas");
    const c222 = catalog.campaigns.find((c) => c.id === C222)!;
    expect(c222.status).toBe("ACTIVE");
    // El tipo de campaña viene de Conversiones aunque la acción no se use como métrica.
    expect(c222.sourceType).toBe("PERFORMANCE_MAX");
    const budgets = await src.getBudgets("2026-09");
    expect(budgets).toEqual([{ month: "2026-09", level: "account", platform: "google", accountId: ACC, campaignId: null, amount: 510000, currency: "MXN" }]);
    const exec = await src.getExecutionControl(NOW);
    expect(exec.find((r) => r.id === "missing-bing")?.status).toBe("ERROR");
    expect((await src.summary()).errors[0]).toContain("Bing");
  });
});

describe("hoja grande: solo se lee la historia necesaria", () => {
  beforeEach(() => invalidate("sheets:"));

  it("rangos A1, letras de columna y ventana por fecha", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(parseA1("'Google '!C2:C")).toEqual({ sheet: "Google ", col1: 2, row1: 2, col2: 2, row2: null });
    expect(parseA1("'It''s'!1:1")).toEqual({ sheet: "It's", col1: null, row1: 1, col2: null, row2: 1 });
    const dates: Cell[] = ["2026-01-01", "2026-05-01", "2026-09-01", "2026-09-28", ""];
    expect(readWindow(dates, "2026-08-14", TZ)).toEqual({ first: 2, last: 3, total: 4 });
    expect(readWindow(dates, "2026-10-01", TZ)).toEqual({ first: 4, last: 3, total: 4 });
    // Desordenada: se lee completa.
    expect(readWindow(["2026-09-28", "2026-01-01"], "2026-08-14", TZ)).toEqual({ first: 0, last: 1, total: 2 });
  });

  it("lee encabezados, la columna de fecha y solo las filas recientes", async () => {
    const tabs = baseTabs();
    const old: Cell[][] = [];
    for (let i = 0; i < 300; i++) old.push([serial("2026-05-01"), "izzi - Ofertas", `Campaña vieja ${i}`, "MXN", 10, 1, 0.1, 5, 5, 5, 0, 0, 0]);
    tabs["Google "].splice(1, 0, ...old);
    const { src, reader } = source(tabs);
    const daily = await src.getDaily({ from: "2026-05-01", to: "2026-09-28", level: "campaign", platforms: ["google"] });
    expect(daily.some((r) => r.date === "2026-05-01")).toBe(false);
    expect(daily.filter((r) => r.date === "2026-09-28")).toHaveLength(2);
    expect(reader.requested).toContain("'Google '!1:1");
    expect(reader.requested).toContain("'Google '!A2:A");
    // Las 300 filas viejas (filas 2 a 301) no se piden.
    expect(reader.requested).toContain("'Google '!A302:M305");
    expect((await src.summary()).tabs.find((t) => t.sheet === "Google")?.rows).toBe(304);
  });

  it("llaves por nombre sin choques y unión con pestañas que sí traen IDs", () => {
    const a = "WhatsApp//Spiderman //izzi telecom/Septiembre - Mensajes - VPM - Nacional - Hombres 25-44";
    const b = "WhatsApp//Spiderman //izzi telecom/Septiembre - Mensajes - VPM - Nacional - Mujeres 25-44";
    expect(slugId(a)).not.toBe(slugId(b));
    expect(slugId(a).length).toBeLessThanOrEqual(60);
    expect(slugId("izzi – Performance AO - mxn")).toBe("izzi-performance-ao-mxn");
    const src = { ...mapping.sources.find((s) => s.sheet === "Google")! };
    const named = parseTab([GOOGLE_HEAD, [serial("2026-09-28"), "izzi - Ofertas", "MXSUR - CPC Manual", "MXN", 1, 1, 1, 400, 1, 1, 1, 0, 1]], src, { tz: TZ, decimalComma: false });
    expect(named.missingColumns).toEqual([]); // sin columnas de ID no es un problema
    const withIds = parseTab(
      [["Date", "Account ID", "Account", "Campaign ID", "Campaign", "Cost"], ["2026-09-28", "736-792-8294", "izzi - Ofertas", 111, "MXSUR - CPC Manual", 1]],
      src,
      { tz: TZ, decimalComma: false },
    );
    const all = harmonizeIds([...named.records, ...withIds.records]);
    expect(new Set(all.map((r) => r.accountId))).toEqual(new Set(["7367928294"]));
    expect(new Set(all.map((r) => r.campaignId))).toEqual(new Set(["111"]));
  });
});
