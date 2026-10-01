import { prepareEnv } from "../src/config/load-env.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { verificationArgs } from "../src/verification/cli-options.js";
import { verificationSheets, verifyProviders } from "../src/verification/run.js";
import { rotationWriter } from "../src/verification/token-writer.js";
import { writeWorkbook } from "../src/verification/output.js";

async function main() {
  const args = verificationArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "npm run verificar -- [--proveedores google,meta,tiktok,microsoft,spotify,x] [--fecha YYYY-MM-DD] [--cuentas plataforma:ID,ID] [--limite-cuentas 25] [--salida reportes/lectura.xlsx]\nSin --fecha: ayer en la zona de cada cuenta. Sin --proveedores: plataformas configuradas.\nExcel privado en reportes/. 0: lectura completa; 2: errores, avisos o cobertura limitada; 1: fallo del comando.\n",
    );
    return;
  }
  prepareEnv();
  const writer = rotationWriter(".env", process.env.TOKEN_STORE_FILE?.trim() || undefined);
  // A first read is a complete snapshot, not an incremental synchronization window.
  const env = { ...process.env, X_ADS_ACTIVITY_START_TIME: "", X_ADS_ACTIVITY_END_TIME: "" };
  const registry = ProviderRegistry.fromEnv(env, 60000, (name, token) => writer.record(name, token));
  try {
    const read = await verifyProviders(
      registry.list().filter((p) => args.providers.includes(p.slug)),
      {
        date: args.date,
        accounts: args.accounts,
        maxAccounts: args.maxAccounts,
        flushTokens: () => writer.flush(),
      },
    );
    const output = await writeWorkbook("verificacion", verificationSheets(read), args.output);
    const partial = read.operations.some((r) => ["error", "partial", "skipped"].includes(r.state));
    const configured = read.statuses.length;
    process.stdout.write(
      `Excel guardado: ${output}\n${configured} plataformas comprobadas; ${read.accounts.length} cuentas; ${read.performance.length} filas de rendimiento. Consulta Cobertura para errores y límites.\n`,
    );
    process.exitCode = partial || !configured ? 2 : 0;
  } finally {
    await writer.flush();
  }
}
void main().catch(() => {
  process.stderr.write(
    "No se pudo completar el verificador. Comprueba opciones, configuración y archivos privados; no se muestran valores ni cuerpos de error.\n",
  );
  process.exitCode = 1;
});
