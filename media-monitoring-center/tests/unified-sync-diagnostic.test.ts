import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UnifiedSnapshotStore } from "@/lib/unified/store";
import { syncUnified } from "@/lib/unified/sync";
import { safeApiDiagnostic } from "@/lib/unified/diagnostic";
import type { UnifiedScope } from "@/lib/unified/schema";

// The unified API answers every PROVIDER_ERROR with HTTP 502. Without its allowlisted details the
// monitor could not tell a Microsoft submit failure from a refused signed download.
const now = new Date("2026-10-02T12:00:00Z");
const scope: UnifiedScope = { platform: "microsoft", accountId: "101", brand: "izzi", currency: "MXN" };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function store() { const d = await mkdtemp(join(tmpdir(), "sync-diagnostic-")); dirs.push(d); return new UnifiedSnapshotStore(d); }
const providerError = (details: Record<string, unknown>) => Response.json({ error: { code: "PROVIDER_ERROR", message: "Detalle con https://bingadsappsstorageprod.blob.core.windows.net/r.zip?sig=secreto", details, request_id: "req-1" } }, { status: 502 });
const transport = (performance: () => Response, catalog?: () => Response): typeof fetch => async input => {
  const route = new URL(String(input)).pathname.split("/").pop();
  if (route === "accounts") return catalog?.() ?? Response.json({ data: [{ platform: "microsoft", account_id: "101", account_name: "Cuenta ficticia", currency: "MXN", timezone: "UTC" }], errors: [] });
  if (route === "campaigns") return Response.json({ data: [{ platform: "microsoft", account_id: "101", campaign_id: "c1", campaign_name: "Campaña ficticia", campaign_status: "active", source_status: null, objective: null }], errors: [] });
  return performance();
};
const run = (s: UnifiedSnapshotStore, request: typeof fetch) => syncUnified({ mapping: { version: 1, accounts: [scope] }, store: s, url: "https://api.example.test", apiKey: "clave-ficticia", from: "2026-09-29", to: "2026-09-29", granularities: ["daily"], request, clock: () => now });
function files(dir: string): string[] { return readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? files(p) : [p]; }); }

describe("diagnóstico seguro de errores de la API unificada", () => {
  it("guarda la etapa del 502 de Microsoft sin mensajes ni URLs firmadas", async () => {
    const s = await store();
    const result = await run(s, transport(() => providerError({ provider: "microsoft", stage: "report_download", limitation: "report_download_rejected", http_status: 403, blob_error_code: "AuthenticationFailed", transient: false })));
    const expected = "api_status=502;api_code=PROVIDER_ERROR;stage=report_download;limitation=report_download_rejected;blob_error_code=AuthenticationFailed;http_status=403";
    expect(result[0]).toMatchObject({ status: "FAILED", code: "API_RESPONSE_ERROR", diagnostic: expected });
    expect(await s.attempt(scope, "daily")).toMatchObject({ status: "FAILED", code: "API_RESPONSE_ERROR", diagnostic: expected });
    for (const file of files(s.root)) {
      const body = await readFile(file, "utf8");
      expect(body).not.toContain("sig=secreto");
      expect(body).not.toContain("r.zip");
    }
  });
  it("también registra el diagnóstico cuando falla el catálogo", async () => {
    const s = await store();
    const result = await run(s, transport(() => Response.json({ data: [], errors: [] }), () => providerError({ stage: "report_submit", http_status: 503, microsoft_codes: [0] })));
    expect(result[0].diagnostic).toBe("api_status=502;api_code=PROVIDER_ERROR;stage=report_submit;http_status=503;microsoft_codes=0");
  });
  it("con un cuerpo ilegible o excesivo conserva solo el estado HTTP", async () => {
    const s = await store();
    expect((await run(s, transport(() => new Response("<html>Bad gateway</html>", { status: 502 }))))[0].diagnostic).toBe("api_status=502");
    const big = new Response(JSON.stringify({ error: { code: "PROVIDER_ERROR", details: { stage: "report_parse", padding: "x".repeat(70 * 1024) } } }), { status: 502 });
    expect((await run(s, transport(() => big)))[0].diagnostic).toBe("api_status=502");
  });
  it("descarta campos no permitidos y valores con espacios, rutas o consultas", () => {
    expect(safeApiDiagnostic(502, { error: { code: "PROVIDER_ERROR", details: { stage: "a b", observed_host: "host/ruta?sig=1", url: "https://x", http_status: 9999, token: "t" } } })).toBe("api_status=502;api_code=PROVIDER_ERROR");
    expect(safeApiDiagnostic(502, { error: { code: "texto libre", details: {} } })).toBe("api_status=502");
  });
});
