import "server-only";
import type { BrandId } from "@/lib/brands";
import type { BudgetSnapshot } from "@/lib/services/budget-changes";
import { getRecordStore } from "./store";

/**
 * Foto diaria de presupuestos por marca (`budget-snapshots/<marca>/<fecha>`). Se reescribe como
 * máximo cada 30 minutos para que la foto del día refleje su último estado. Se conservan 60 días.
 */
const prefix = (brand: BrandId) => `budget-snapshots/${brand}/`;

export async function saveBudgetSnapshot(brand: BrandId, snapshot: BudgetSnapshot): Promise<void> {
  const store = getRecordStore();
  const key = `${prefix(brand)}${snapshot.date}`;
  const prev = await store.get<BudgetSnapshot>(key);
  if (prev && Date.parse(snapshot.at) - Date.parse(prev.at) < 30 * 60_000) return;
  await store.set(key, snapshot);
  const keys = (await store.list(prefix(brand))).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - 60))) await store.delete(old);
}

/** La foto más reciente de un día anterior a `date`, si existe. */
export async function latestSnapshotBefore(brand: BrandId, date: string): Promise<BudgetSnapshot | null> {
  const store = getRecordStore();
  const keys = (await store.list(prefix(brand))).filter((k) => k.slice(prefix(brand).length) < date).sort();
  const last = keys.at(-1);
  return last ? store.get<BudgetSnapshot>(last) : null;
}
