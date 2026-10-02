import { checkMicrosoftReportNetwork } from "../src/providers/microsoft/network.js";

async function main() {
  if (process.argv.slice(2).some((arg) => !["--ayuda", "--help"].includes(arg))) throw new Error("Opción desconocida.");
  if (process.argv.length > 2) {
    process.stdout.write(
      "npm run microsoft:red\nComprueba DNS y salida HTTPS al host fijo de informes, con TLS y proxy normales, sin credenciales ni generar reportes.\n",
    );
    return;
  }
  const result = await checkMicrosoftReportNetwork();
  process.stdout.write(JSON.stringify(result) + "\n");
  process.stdout.write(
    result.reachable
      ? "El transporte llega al servidor. Esto no valida una descarga firmada ni las métricas; ejecuta una lectura acotada después.\n"
      : "La ejecución necesita salida HTTPS al host de informes indicado. Con un bloqueo del proxy, habilita ese destino en la infraestructura o ejecuta la API en un entorno autorizado que permita esa salida.\n",
  );
  process.exitCode = result.reachable ? 0 : 2;
}
void main().catch(() => {
  process.stderr.write("No se pudo ejecutar el diagnóstico de red de Microsoft.\n");
  process.exitCode = 1;
});
