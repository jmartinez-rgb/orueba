// Proceso hijo de las pruebas de integridad: incrementa una misma llave del backend File.
// Uso: node --conditions=react-server --import tsx file-store-worker.ts <dir> <key> <n> [hold-and-die]
import { FileRecordStore } from "../../src/lib/records/store";

async function main() {
  const [dir, key, count, mode] = process.argv.slice(2);
  const store = new FileRecordStore(dir);
  if (mode === "hold-and-die") {
    // Caída con el lock tomado: la transformación termina el proceso antes de escribir.
    await store.update<{ n: number }>(key, () => process.exit(9));
    return;
  }
  for (let i = 0; i < Number(count); i++) {
    await store.update<{ n: number }>(key, (current) => ({ n: (current?.n ?? 0) + 1 }));
  }
}
void main().catch(() => { process.exitCode = 1; });
