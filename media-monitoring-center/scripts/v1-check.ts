import { loadEnvConfig } from "@next/env";
import { getEnv } from "../src/lib/config/env";
import { getAuthConfig } from "../src/lib/auth/config";
import { getRecordStore } from "../src/lib/records/store";
import { loadUnifiedMapping } from "../src/lib/unified/store";
import { checkRecordStorage } from "../src/lib/release/records-check";
import { fetchUnifiedStatus } from "../src/lib/integrations/unified-api";
import {
  v1Configuration,
  v1ProviderAccess,
} from "../src/lib/release/readiness";

let phase: "opciones" | "entorno" | "configuracion" | "acceso" | "salida" =
  "opciones";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--sin-red", "--registros", "--ayuda", "--help"].includes(arg)))
    throw new Error("Opción desconocida.");
  if (args.includes("--ayuda") || args.includes("--help")) {
    process.stdout.write(
      "npm run v1:check -- [--sin-red] [--registros]\nRevisa configuración para producción y estados de conexión. --registros escribe, lee y elimina un sondeo aislado para comprobar el almacenamiento; no modifica registros del equipo ni garantiza un volumen durable. No lee hojas ni publica, ni sustituye conciliación o aceptación de v1.\n",
    );
    return;
  }
  // Use the installed Next.js loader and the deployment configuration, never local open-mode defaults.
  phase = "entorno";
  Object.assign(process.env, { NODE_ENV: "production" });
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  // Configuration diagnostics can contain invalid user input. Only fixed check codes leave this command.
  process.env.LOG_LEVEL = "error";
  phase = "configuracion";
  const env = getEnv();
  let unifiedMappingReady = false;
  if (env.dataSource === "unified") {
    try { await loadUnifiedMapping(); unifiedMappingReady = true; } catch { /* Fixed configuration codes below. */ }
  }
  const configuration = v1Configuration(
    env,
    getAuthConfig(),
    getRecordStore().backend,
    unifiedMappingReady,
  );
  const recordStorage = args.includes("--registros") ? await checkRecordStorage(getRecordStore()) : { checked: false, available: null, code: "RECORD_IO_NOT_CHECKED" };
  let access: {
    checked: boolean;
    available: boolean | null;
    providers: Array<{ id: string; state: string; code: string | null }>;
  } = { checked: false, available: null, providers: [] };
  if (!args.includes("--sin-red") && env.unifiedApi.configured) {
    phase = "acceso";
    const status = await fetchUnifiedStatus();
    access = status.ok
      ? {
          checked: true,
          ...v1ProviderAccess(status.providers),
        }
      : { checked: true, available: false, providers: [] };
  }
  phase = "salida";
  process.stdout.write(
    JSON.stringify({ ...configuration, recordStorage, providerAccess: access }) + "\n",
  );
  process.stdout.write(
    "Esta comprobación es de configuración y acceso. Faltan la lectura real de métricas, su conciliación, verificar registros tras reinicio y aceptar los flujos de cada rol antes de liberar v1.\n",
  );
  process.exitCode =
    configuration.configurationReady && access.available === true && (!recordStorage.checked || recordStorage.available) ? 0 : 2;
}

void main().catch(() => {
  process.stderr.write(
    `No se pudo comprobar la preparación de v1 en la etapa ${phase}. Revisa configuración y opciones; no se muestran valores privados.\n`,
  );
  process.exitCode = 1;
});
