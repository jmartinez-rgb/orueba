import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSmokeOptions } from "@/lib/release/smoke-options";

describe("opciones de comprobación pública", () => {
  it("no infiere URL de las variables privadas", () => expect(parseSmokeOptions([])).toEqual({ help: false }));
  it("admite URL explícitas y timeout acotado", () => expect(parseSmokeOptions(["--monitor", "https://monitor.example.test", "--api", "https://api.example.test/api/v1", "--timeout-ms", "15000"])).toEqual({ monitorUrl: "https://monitor.example.test", apiUrl: "https://api.example.test/api/v1", timeoutMs: 15000, help: false }));
  it.each(["--help", "--ayuda"])("admite ayuda %s", flag => expect(parseSmokeOptions([flag])).toEqual({ help: true }));
  it.each([
    ["--monitor"], ["--api", ""], ["--api", "--monitor"], ["--token", "private-value"],
    ["--monitor", "a", "--monitor", "b"], ["--help", "--help"], ["--timeout-ms"],
    ["--timeout-ms", "999"], ["--timeout-ms", "15001"], ["--timeout-ms", "NaN"],
    ["--timeout-ms", "1000.5"], ["--timeout-ms", "1e3"], ["--timeout-ms", "-1000"],
    ["--timeout-ms", "1000", "--timeout-ms", "2000"], ["https://api.example.test"],
  ].map(args => ({ args })))("rechaza opciones inválidas sin mostrar valores $args", ({ args }) => {
    expect(() => parseSmokeOptions(args)).toThrow("INVALID_SMOKE_OPTIONS");
  });
});

async function child(args: string[], extraEnv: Record<string, string> = {}, fixture?: string) {
  const root = resolve(import.meta.dirname, "..");
  const directory = await mkdtemp(join(tmpdir(), "public-smoke-cli-"));
  try {
    const guard = join(directory, "no-network.mjs");
    await writeFile(guard, fixture ?? "globalThis.fetch = () => { throw new Error('UNEXPECTED_NETWORK'); };\n");
    // Deliberately conflicting private config: the CLI must never load it or use its URLs.
    await writeFile(join(directory, ".env"), "UNIFIED_ADS_API_URL=https://private-config.example.test\nUNIFIED_ADS_API_KEY=private-value\n");
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    return await new Promise<{ code: number | null; stdout: string; stderr: string }>(done => {
      execFile(process.execPath, ["--import", pathToFileURL(guard).href, "--import", loader, join(root, "scripts/production-smoke.ts"), ...args], {
        cwd: directory, timeout: 10000, encoding: "utf8",
        env: { PATH: process.env.PATH, TSX_TSCONFIG_PATH: join(root, "tsconfig.json"), UNIFIED_ADS_API_URL: "https://private-runtime.example.test", UNIFIED_ADS_API_KEY: "private-key", ...extraEnv, NODE_ENV: "production" },
      }, (error, stdout, stderr) => done({ code: error ? typeof error.code === "number" ? error.code : null : 0, stdout, stderr }));
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

it("CLI sin URL queda pendiente, sin leer .env ni llamar fetch", async () => {
  const result = await child([]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("");
  const report = JSON.parse(result.stdout.trim());
  expect(report.certifiesV1).toBe(false);
  expect(report.exitCode).toBe(2);
  expect(result.stdout).not.toMatch(/private-|UNEXPECTED_NETWORK/);
});

it("CLI ayuda funciona sin configuración y sin llamadas", async () => {
  const result = await child(["--help"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("produccion:smoke");
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toMatch(/private-|UNEXPECTED_NETWORK/);
});

it("CLI bloquea un runtime que desactiva la verificación TLS antes de llamar fetch", async () => {
  const result = await child(["--monitor", "https://monitor.example.test", "--api", "https://api.example.test"], { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout.trim()).code).toBe("TLS_VERIFICATION_DISABLED");
  expect(result.stdout).not.toMatch(/private-|UNEXPECTED_NETWORK|example\.test/);
});

it("CLI opciones privadas desconocidas fallan sin exponerlas", async () => {
  const result = await child(["--token", "private-value"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("SMOKE_CHECK_FAILED");
  expect(result.stderr).not.toContain("private-value");
});

it("CLI conecta ambos servicios explícitos con siete GET sin usar las llaves privadas", async () => {
  const fixture = `
const expected = [
  ['monitor.example.test', '/api/health'], ['monitor.example.test', '/login'],
  ['monitor.example.test', '/api/settings'], ['monitor.example.test', '/api/nexus'],
  ['api.example.test', '/api/v1/health'], ['api.example.test', '/api/v1/providers'],
  ['api.example.test', '/api/v1/accounts']
];
let count = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(input), next = expected[count++];
  if (!next || url.hostname !== next[0] || url.pathname !== next[1] || options.method !== 'GET' || options.credentials !== 'omit' || options.redirect !== 'manual') throw new Error('UNEXPECTED_NETWORK');
  const headers = new Headers(options.headers);
  if (headers.has('authorization') || headers.has('x-api-key') || headers.has('cookie')) throw new Error('PRIVATE_CREDENTIAL_SENT');
  const now = new Date().toISOString();
  if (url.pathname === '/login') return new Response('<html><form><input type="password"></form></html>', {headers:{'content-type':'text/html'}});
  if (url.pathname === '/api/health') return Response.json({ok:true,app:'fixture',version:'0.1.0',mode:'unified',time:now,integrations:{sheets:false,bigquery:false,n8n:false,whatsapp:false}});
  if (url.pathname === '/api/v1/health') return Response.json({status:'ok',service:'unified-ads-api',version:'0.1.0',environment:'production',uptime_s:1,timestamp:now});
  return Response.json(url.hostname === 'monitor.example.test' ? {ok:false,message:'login required'} : {error:{code:'AUTH_ERROR',message:'key required',request_id:'fixture'}}, {status:401});
};
process.on('exit', () => { if (count !== 7) process.exitCode = 9; });
`;
  const result = await child(["--monitor", "https://monitor.example.test", "--api", "https://api.example.test/api/v1"], {}, fixture);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ exitCode: 0, certifiesV1: false, counts: { pass: 7, fail: 0, blocked: 0 } });
  expect(result.stdout).not.toMatch(/private-|UNEXPECTED_NETWORK|PRIVATE_CREDENTIAL_SENT|example\.test/);
});
