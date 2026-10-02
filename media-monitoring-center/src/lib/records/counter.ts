import "server-only";
import { RecordStoreError, type RecordStore } from "./store";

interface Counter { n: number }

function counterValue(current: Counter | null): number {
  if (current === null) return 0;
  if (typeof current !== "object" || Array.isArray(current) || !Number.isSafeInteger(current.n) || current.n < 0) throw new RecordStoreError();
  return current.n;
}

/**
 * Reserve a sequence number before creating its record. The pure transform can
 * replay after a conflict or an ambiguous receipt: gaps are allowed, reused IDs
 * are not. Reservation and record creation are separate writes, not a transaction.
 * File/memory queues cover this process; Blobs reservations use conditional writes.
 */
export async function nextRecordId(store: RecordStore, collection: string, prefix: string): Promise<string> {
  for (;;) {
    const reserved = await store.update<Counter>(`counters/${collection}`, (current) => {
      const previous = counterValue(current);
      if (previous >= Number.MAX_SAFE_INTEGER) throw new RecordStoreError();
      return { n: previous + 1 };
    });
    const n = counterValue(reserved);
    if (n < 1) throw new RecordStoreError();
    const id = `${prefix}-${String(n).padStart(4, "0")}`;
    // A restored or missing counter can lag behind historical records.
    if (await store.get(`${collection}/${id}`) === null) return id;
  }
}
