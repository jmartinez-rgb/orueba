import { z } from "zod";

/**
 * Safe diagnosis of a failed unified API response. Only allowlisted tokens survive: the API code,
 * its HTTP status and provider stage/limitation/status fields. Messages, bodies, URLs (signed or
 * not), headers and tokens are never stored. Mirrors unified-ads-api/src/utils/diagnostics.ts.
 */
const TOKEN_FIELDS = ["stage", "limitation", "network_reason", "report_status", "blob_error_code", "observed_host"] as const;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}$/;
export const DIAGNOSTIC_PATTERN = /^[A-Za-z0-9_.:;=|-]{1,600}$/;
const MAX_ERROR_BODY = 64 * 1024;
const envelope = z.object({ error: z.object({ code: z.string().regex(/^[A-Z_]{1,80}$/), details: z.record(z.string(), z.unknown()).nullable().optional() }) });

export function safeApiDiagnostic(status: number, body: unknown): string | null {
  const parts = Number.isInteger(status) && status >= 100 && status <= 599 ? [`api_status=${status}`] : [];
  const parsed = envelope.safeParse(body);
  if (parsed.success) {
    parts.push(`api_code=${parsed.data.error.code}`);
    const details = parsed.data.error.details ?? {};
    for (const key of TOKEN_FIELDS) {
      const value = details[key];
      if (typeof value === "string" && SAFE_TOKEN.test(value)) parts.push(`${key}=${value}`);
    }
    const http = details.http_status;
    if (typeof http === "number" && Number.isInteger(http) && http >= 100 && http <= 599) parts.push(`http_status=${http}`);
    const codes = details.microsoft_codes;
    if (Array.isArray(codes)) {
      const safe = codes.filter((c): c is number => typeof c === "number" && Number.isInteger(c)).slice(0, 10);
      if (safe.length) parts.push(`microsoft_codes=${safe.join("|")}`);
    }
  }
  const text = parts.join(";");
  return text && DIAGNOSTIC_PATTERN.test(text) ? text : null;
}

/** Reads at most 64 KiB of an error body; an oversized or unreadable body yields only the status. */
export async function responseDiagnostic(response: Response): Promise<string | null> {
  if (!response.body) return safeApiDiagnostic(response.status, null);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, oversized = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_ERROR_BODY) { oversized = true; break; }
      chunks.push(chunk.value);
    }
  } catch { oversized = true; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (oversized) return safeApiDiagnostic(response.status, null);
  let body: unknown = null;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* status only */ }
  return safeApiDiagnostic(response.status, body);
}
