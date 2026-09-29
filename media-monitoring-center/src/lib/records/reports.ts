import "server-only";
import { addDays, businessDate } from "@/lib/time/tz";
import { getRecordStore, readImmutable, stamp } from "./store";
import { DEFAULT_BRAND, type BrandId } from "@/lib/brands";

/** Historial de mensajes de monitoreo guardados (lo que se envió por WhatsApp y quién lo generó). */
export interface SavedReport {
  id: string;
  at: string;
  businessDate: string;
  cutoffHour: number;
  by: string;
  text: string;
  platforms: string[];
  summary: string;
  /** Marca del monitoreo (sin dato = izzi). */
  brand?: BrandId;
}

const TZ = () => process.env.APP_TIMEZONE || "America/Mexico_City";

export async function saveReport(input: Omit<SavedReport, "id" | "at">): Promise<SavedReport> {
  const at = new Date();
  const id = `RPT-${stamp(at)}`;
  const rec: SavedReport = { ...input, id, at: at.toISOString(), text: input.text.slice(0, 8000), summary: input.summary.slice(0, 300) };
  await getRecordStore().set(`reports/${businessDate(at, TZ())}/${id}`, rec);
  return rec;
}

export async function listReports(days = 30, brand?: BrandId): Promise<SavedReport[]> {
  const store = getRecordStore();
  const today = businessDate(new Date(), TZ());
  const lists = await Promise.all(Array.from({ length: Math.min(days, 120) }, (_, i) => store.list(`reports/${addDays(today, -i)}/`)));
  const keys = lists.flat().sort().reverse().slice(0, 300);
  const rows = await readImmutable<SavedReport>(store, keys);
  return rows.filter((r) => !brand || (r.brand ?? DEFAULT_BRAND) === brand).sort((a, b) => b.at.localeCompare(a.at));
}
