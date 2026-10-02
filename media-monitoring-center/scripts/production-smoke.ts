import { runProductionSmoke } from "../src/lib/release/production-smoke";
import { parseSmokeOptions } from "../src/lib/release/smoke-options";

async function main() {
  const options = parseSmokeOptions(process.argv.slice(2));
  if (options.help) {
    console.log("npm run produccion:smoke -- --monitor https://monitoreo.example.com --api https://api.example.com [--timeout-ms 1000..15000]\nComprueba siete endpoints públicos sin llaves, cookies, OAuth ni lecturas publicitarias. No carga .env, no sigue redirecciones ni escribe datos. Sin ambas URL queda pendiente. Salida 0: comprobaciones HTTP pasan; 1: fallo u opciones inválidas; 2: falta información o no se pudo comprobar. No certifica la v1 ni la persistencia del alojamiento.");
    return;
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    console.log(JSON.stringify({ scope: "public_endpoints", certifiesV1: false, code: "TLS_VERIFICATION_DISABLED", exitCode: 2 }));
    process.exitCode = 2;
    return;
  }
  const report = await runProductionSmoke(options);
  console.log(JSON.stringify(report));
  process.exitCode = report.exitCode;
}

void main().catch(() => {
  console.error(JSON.stringify({ scope: "public_endpoints", certifiesV1: false, code: "SMOKE_CHECK_FAILED", exitCode: 1 }));
  process.exitCode = 1;
});
