import { describe, expect, it } from "vitest";
import { colocatedApiUrl, deploymentConfiguration, parseReadinessOptions, productionApiUrl } from "@/lib/release/deployment";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const base = {
  target: "contenedor" as const, volume: "/var/data", dataSource: "unified",
  recordsBackend: "file" as const, recordsDirectory: "/var/data/records",
  unifiedDirectory: "/var/data/unified", apiUrl: "https://api.example.test",
};

describe("transporte configurado, sin confundirlo con acceso real", () => {
  it.each([
    undefined, "", "invalid", "http://api.example.test", "https://user:private@api.example.test", "https://@api.example.test",
    "https://api.example.test?key=private", "https://api.example.test#private",
    "https://localhost", "https://localhost.", "https://api.localhost", "https://127.1",
    "https://127.255.2.3", "https://2130706433", "https://0.0.0.0", "https://[::1]",
    "https://[::]", "https://[::ffff:127.0.0.1]", "https://[::ffff:127.250.0.1]",
    "https://[::ffff:0.0.0.0]", "https://api.example.test\n",
  ])("rechaza URL incompatible: %s", value => expect(productionApiUrl(value)).toBe(false));
  it.each(["https://api.example.test", "https://api.example.test:8443/base", "https://[2001:db8::5]"])("acepta HTTPS declarado sin consultarlo: %s", value => expect(productionApiUrl(value)).toBe(true));
});

describe("topología del destino", () => {
  it("local conserva comportamiento y no certifica producción", () => {
    expect(deploymentConfiguration({ ...base, target: "local", apiUrl: "http://localhost:8080", recordsBackend: "memory" })).toMatchObject({ configurationReady: true, checks: [], runtimeVerified: false, certifiesV1: false, pendingEvidence: ["PRODUCTION_NOT_CHECKED"] });
  });
  it("Netlify Blobs para registros no mueve el histórico unificado", () => {
    const report = deploymentConfiguration({ ...base, target: "netlify", recordsBackend: "netlify-blobs" });
    expect(report.configurationReady).toBe(false);
    expect(report.checks).toContainEqual({ id: "history_topology", status: "pending", code: "NETLIFY_UNIFIED_FILE_HISTORY_UNSUPPORTED" });
    expect(report.checks.find(c => c.id === "records_topology")?.status).toBe("configured");
  });
  it.each(["file", "memory"] as const)("Netlify no acepta registros %s", recordsBackend => {
    expect(deploymentConfiguration({ ...base, target: "netlify", dataSource: "bigquery", recordsBackend }).configurationReady).toBe(false);
  });
  it("declara backend externo compatible sin certificarlo ni inventar un volumen", () => {
    expect(deploymentConfiguration({ ...base, target: "netlify", dataSource: "bigquery", recordsBackend: "netlify-blobs" })).toMatchObject({ configurationReady: true, runtimeVerified: false, certifiesV1: false });
  });
  it("un contenedor con rutas bajo volumen es solo configuración", () => {
    const report = deploymentConfiguration(base);
    expect(report.configurationReady).toBe(true);
    expect(report.runtimeVerified).toBe(false);
    expect(report.pendingEvidence).toContain("DURABLE_STORAGE_RESTART_NOT_VERIFIED");
    expect(report.pendingEvidence).toContain("TOKEN_ROTATION_DURABILITY_NOT_VERIFIED");
    expect(report.pendingEvidence).toContain("EXTRACTION_WORKER_NOT_VERIFIED");
  });
  it.each([undefined, "/", "relative", "/var/data/../elsewhere"])("rechaza raíz inválida o incompatible %s", volume => {
    expect(deploymentConfiguration({ ...base, volume }).configurationReady).toBe(false);
  });
  it.each(["/tmp/records", "/var/database/records", "/var/data/../escape", ".data/records", "/var/data\u0000bad"])("no acepta registros fuera del volumen %s", recordsDirectory => {
    expect(deploymentConfiguration({ ...base, recordsDirectory }).checks.find(c => c.id === "records_volume")?.status).toBe("pending");
  });
  it("las rutas normalizadas dentro del volumen funcionan", () => {
    expect(deploymentConfiguration({ ...base, recordsDirectory: "/var/data/a/../records/", unifiedDirectory: "/var/data" }).configurationReady).toBe(true);
  });
  it("histórico sin ruta durable impide la configuración aunque registros sean externos", () => {
    expect(deploymentConfiguration({ ...base, recordsBackend: "netlify-blobs", unifiedDirectory: undefined }).configurationReady).toBe(false);
  });
  it("una fuente externa no demanda un archivo histórico que no usa", () => {
    expect(deploymentConfiguration({ ...base, dataSource: "bigquery", recordsBackend: "netlify-blobs", volume: undefined, unifiedDirectory: undefined }).configurationReady).toBe(true);
  });
  it("registros en memoria permanecen bloqueados incluso con volumen declarado", () => {
    expect(deploymentConfiguration({ ...base, recordsBackend: "memory" }).configurationReady).toBe(false);
  });
  it("no registra URLs, volúmenes, paths ni valores privados", () => {
    const report = deploymentConfiguration({ ...base, apiUrl: "https://private:user@private.example.test?private=1", recordsDirectory: "/private/records", unifiedDirectory: "/private/history", volume: "/private/volume" });
    expect(JSON.stringify(report)).not.toContain("private");
  });
});

describe("Replit: sin disco persistente, todo en PostgreSQL", () => {
  const replit = { target: "replit" as const, dataSource: "unified", recordsBackend: "postgres" as const, unifiedStore: "postgres" as const, apiUrl: "http://127.0.0.1:8080" };
  it("PostgreSQL para registros e histórico con la API en loopback es solo configuración", () => {
    expect(deploymentConfiguration(replit)).toMatchObject({ configurationReady: true, runtimeVerified: false, certifiesV1: false, checks: [
      { id: "api_transport", code: "COLOCATED_LOOPBACK_API_CONFIGURED" }, { id: "records_topology", code: "POSTGRES_RECORD_BACKEND_CONFIGURED" }, { id: "history_topology", code: "POSTGRES_HISTORY_CONFIGURED" },
    ] });
  });
  it.each([
    [{ recordsBackend: "file" as const }, "REPLIT_REQUIRES_POSTGRES_RECORDS"],
    [{ unifiedStore: "file" as const }, "REPLIT_REQUIRES_POSTGRES_HISTORY"],
    [{ apiUrl: "http://api.example.test" }, "PRODUCTION_API_URL_INVALID"],
  ])("archivos locales o API sin TLS fuera de loopback quedan pendientes: %o", (patch, code) => {
    const report = deploymentConfiguration({ ...replit, ...patch });
    expect(report.configurationReady).toBe(false);
    expect(report.checks.map(check => check.code)).toContain(code);
  });
  it.each(["http://127.0.0.1:8080", "http://127.0.0.1:8080/"])("acepta la API local de la misma máquina: %s", value => expect(colocatedApiUrl(value)).toBe(true));
  it.each([undefined, "http://localhost:8080", "http://127.0.0.1", "http://10.0.0.5:8080", "http://user:x@127.0.0.1:8080", "http://127.0.0.1:8080/api?k=1", "https://127.0.0.1:8080"])("rechaza cualquier otro transporte sin TLS: %s", value => expect(colocatedApiUrl(value)).toBe(false));
  it("acepta --destino replit sin volumen", () => expect(parseReadinessOptions(["--destino", "replit", "--sin-red"])).toMatchObject({ target: "replit", noNetwork: true }));
  it("rechaza --volumen con replit", () => expect(() => parseReadinessOptions(["--destino", "replit", "--volumen", "/var/data"])).toThrow());
});

describe("opciones explícitas", () => {
  it("compatibilidad local predeterminada", () => expect(parseReadinessOptions(["--sin-red", "--registros"])).toMatchObject({ target: "local", noNetwork: true, records: true }));
  it("contenedor con volumen absoluto", () => expect(parseReadinessOptions(["--destino", "contenedor", "--volumen", "/var/data", "--sin-red"])).toMatchObject({ target: "contenedor", volume: "/var/data", noNetwork: true }));
  it.each([
    ["--destino"], ["--destino", "cloudrun"], ["--destino", "contenedor", "--volumen"],
    ["--destino", "contenedor", "--volumen", "/"], ["--destino", "contenedor", "--volumen", "relative"],
    ["--destino", "contenedor", "--volumen", "/var/.."], ["--volumen", "/var/data"],
    ["--sin-red", "--sin-red"], ["--destino", "local", "--destino", "netlify"], ["--secret", "private"],
  ].map(args => ({ args })))("opciones inválidas no se aplican: $args", ({ args }) => expect(() => parseReadinessOptions(args)).toThrow());
});

it("el CLI aplica el destino declarado sin red ni exposición de valores", async () => {
  const root = resolve(import.meta.dirname, "..");
  const directory = await mkdtemp(join(tmpdir(), "deployment-cli-"));
  try {
    const guard = join(directory, "no-network.mjs");
    await writeFile(guard, "globalThis.fetch = () => { throw new Error('UNEXPECTED_NETWORK'); };\n");
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(done => {
      execFile(process.execPath, ["--conditions=react-server", "--import", pathToFileURL(guard).href, "--import", loader, join(root, "scripts/v1-check.ts"), "--sin-red", "--destino", "netlify"], {
        cwd: directory, timeout: 10000, encoding: "utf8",
        env: { NODE_ENV: "production", PATH: process.env.PATH, TSX_TSCONFIG_PATH: join(root, "tsconfig.json"), DATA_SOURCE: "unified", UNIFIED_ADS_DATA_DIR: join(directory, "private-history"), UNIFIED_ADS_API_URL: "https://private-api.example.test", UNIFIED_ADS_API_KEY: "private-key", AUTH_MODE: "password", AUTH_SECRET: "private-session-secret-with-32-characters", RECORDS_BACKEND: "memory" },
      }, (error, stdout, stderr) => done({ code: error ? typeof error.code === "number" ? error.code : null : 0, stdout, stderr }));
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout.split("\n")[0]);
    expect(report.deployment.target).toBe("netlify");
    expect(report.deployment.configurationReady).toBe(false);
    expect(report.deployment.checks).toContainEqual({ id: "history_topology", status: "pending", code: "NETLIFY_UNIFIED_FILE_HISTORY_UNSUPPORTED" });
    expect(report.providerAccess.checked).toBe(false);
    expect(report.recordStorage.checked).toBe(false);
    expect(result.stdout).not.toContain("private-");
    expect(result.stdout).not.toContain("UNEXPECTED_NETWORK");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
