import "server-only";
import { readFileSync } from "node:fs";
import { sheetsGet } from "@/lib/google/sheets";
import { sliceRanges, type Cell } from "./parse";

/** Acceso de solo lectura a la hoja. Se puede sustituir en pruebas por un lector de archivo. */
export interface SheetsInfo {
  title: string;
  timeZone: string | null;
  locale: string | null;
  sheets: string[];
}

export interface SheetsReader {
  readonly kind: "google" | "fixture";
  info(spreadsheetId: string): Promise<SheetsInfo>;
  /**
   * Valores sin formato de cada rango (fechas como número de serie). Con majorDimension
   * "COLUMNS" cada arreglo interno es una columna (sirve para leer solo la columna de fecha).
   */
  batchGet(spreadsheetId: string, ranges: string[], opts?: BatchGetOptions): Promise<Cell[][][]>;
}

export interface BatchGetOptions {
  majorDimension?: "ROWS" | "COLUMNS";
}

export class GoogleSheetsReader implements SheetsReader {
  readonly kind = "google" as const;

  async info(spreadsheetId: string): Promise<SheetsInfo> {
    const data = await sheetsGet<{ properties?: { title?: string; timeZone?: string; locale?: string }; sheets?: Array<{ properties?: { title?: string } }> }>(
      `${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("properties(title,timeZone,locale),sheets(properties(title))")}`,
      "sheets.info",
    );
    return {
      title: data.properties?.title ?? "",
      timeZone: data.properties?.timeZone ?? null,
      locale: data.properties?.locale ?? null,
      sheets: (data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean),
    };
  }

  async batchGet(spreadsheetId: string, ranges: string[], opts?: BatchGetOptions): Promise<Cell[][][]> {
    if (!ranges.length) return [];
    const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const data = await sheetsGet<{ valueRanges?: Array<{ values?: Cell[][] }> }>(
      `${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs}&majorDimension=${opts?.majorDimension ?? "ROWS"}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
      "sheets.read",
    );
    return ranges.map((_, i) => data.valueRanges?.[i]?.values ?? []);
  }
}

interface FixtureFile {
  info: SheetsInfo;
  tabs: Record<string, Cell[][]>;
}

/**
 * Lector de archivo JSON ({info, tabs}) para probar la app sin Google (SHEETS_FIXTURE_FILE,
 * solo fuera de producción). El archivo se vuelve a leer en cada consulta.
 */
export class FixtureSheetsReader implements SheetsReader {
  readonly kind = "fixture" as const;
  constructor(private readonly file: string) {}

  private load(): FixtureFile {
    return JSON.parse(readFileSync(this.file, "utf8")) as FixtureFile;
  }
  async info(): Promise<SheetsInfo> {
    const f = this.load();
    return { ...f.info, sheets: Object.keys(f.tabs) };
  }
  async batchGet(_id: string, ranges: string[], opts?: BatchGetOptions): Promise<Cell[][][]> {
    return sliceRanges(this.load().tabs, ranges, opts?.majorDimension);
  }
}
