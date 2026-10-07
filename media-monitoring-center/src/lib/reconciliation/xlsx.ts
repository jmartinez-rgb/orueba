import { inflateRawSync } from "node:zlib";
import { ReconciliationError } from "./reconcile";

/**
 * Minimal reader for single-sheet .xlsx interface exports (Meta, Microsoft, TikTok…): unzips with the
 * built-in zlib, reads shared strings and the only worksheet, and returns rows of cell text. A workbook
 * with several sheets is refused, so a full workbook (for example one with sales tabs) is never read.
 */
const MAX_PART_BYTES = 16 * 1024 * 1024;

function entries(zip: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ReconciliationError("INVALID_XLSX");
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const wanted: { name: string; method: number; compressed: number; size: number; local: number }[] = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw new ReconciliationError("INVALID_XLSX");
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (/^xl\/(sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) wanted.push({ name, method: zip.readUInt16LE(offset + 10), compressed: zip.readUInt32LE(offset + 20), size: zip.readUInt32LE(offset + 24), local: zip.readUInt32LE(offset + 42) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  // Decide from the directory alone: a workbook with several sheets is refused before any sheet is opened.
  const sheets = wanted.filter(part => part.name.startsWith("xl/worksheets/")).length;
  if (sheets !== 1) throw new ReconciliationError(sheets ? "XLSX_MULTIPLE_SHEETS" : "INVALID_XLSX");
  const parts = new Map<string, Buffer>();
  for (const part of wanted) {
    if (part.size > MAX_PART_BYTES || part.local + 30 > zip.length || zip.readUInt32LE(part.local) !== 0x04034b50) throw new ReconciliationError("INVALID_XLSX");
    const start = part.local + 30 + zip.readUInt16LE(part.local + 26) + zip.readUInt16LE(part.local + 28);
    const raw = zip.subarray(start, start + part.compressed);
    let data: Buffer;
    try { data = part.method === 0 ? Buffer.from(raw) : part.method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES }) : (() => { throw new Error(); })(); }
    catch { throw new ReconciliationError("INVALID_XLSX"); }
    if (data.length !== part.size) throw new ReconciliationError("INVALID_XLSX");
    parts.set(part.name, data);
  }
  return parts;
}

const unescape = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (named[e.toLowerCase()]) return named[e.toLowerCase()];
  const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return String.fromCodePoint(code);
});
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(m => unescape(m[1] ?? "")).join("");
const columnIndex = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function readXlsxRecords(bytes: Buffer): string[][] {
  const parts = entries(bytes);
  const sheets = [...parts.keys()].filter(name => name.startsWith("xl/worksheets/"));
  const shared = [...(parts.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  const rows: string[][] = [];
  for (const row of parts.get(sheets[0])!.toString("utf8").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1] ?? "n";
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? "")?.[1];
      let text = "";
      if (type === "s" && value !== undefined) { const s = shared[Number(value)]; if (s === undefined) throw new ReconciliationError("INVALID_XLSX"); text = s; }
      else if (type === "inlineStr") text = texts(cell[2] ?? "");
      else if (value !== undefined) {
        const raw = unescape(value);
        // Numbers are written in their shortest exact form (1609.54, not 1609.5400000000001 or 1.6E3).
        text = type === "n" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? String(Number(raw)) : raw;
      }
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push("");
      cells[index] = text;
    }
    rows.push(cells);
  }
  return rows;
}
