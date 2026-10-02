import type { RecordStore } from "@/lib/records/store";

/** Sondeo reversible y aislado: prueba permisos reales, nunca garantiza durabilidad del volumen. */
export async function checkRecordStorage(store: RecordStore) {
  if (store.backend === "memory") return { checked: true, available: false, code: "VOLATILE_RECORDS" };
  const nonce = crypto.randomUUID(), key = `validation/storage/${nonce}`;
  let available = false;
  try {
    await store.set(key, { nonce });
    available = (await store.get<{ nonce: string }>(key))?.nonce === nonce;
  } catch { /* Los errores originales pueden contener información privada. */ }
  finally { try { await store.delete(key); } catch { available = false; } }
  return { checked: true, available, code: available ? "RECORD_IO_VERIFIED" : "RECORD_IO_FAILED" };
}
