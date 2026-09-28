import "server-only";
import { getSnapshot, SnapshotError, type Snapshot } from "./snapshot";

export type SafeSnapshot = { ok: true; snap: Snapshot } | { ok: false; message: string; technical: string };

/** Carga el snapshot sin romper la página: los errores técnicos se muestran detrás de "Ver detalles". */
export async function safeSnapshot(): Promise<SafeSnapshot> {
  try {
    return { ok: true, snap: await getSnapshot() };
  } catch (err) {
    if (err instanceof SnapshotError) return { ok: false, message: err.friendly, technical: err.technical };
    return { ok: false, message: "No pudimos cargar el monitoreo.", technical: err instanceof Error ? err.message : String(err) };
  }
}
