import { isApiError } from "./errors.js";

/**
 * Allowlisted, non-secret diagnostic fields an operator may see for a failed provider read.
 * Messages, bodies, URLs (signed or not), headers and tokens are never included.
 */
const TOKEN_FIELDS = [
  "stage",
  "limitation",
  "network_reason",
  "report_status",
  "blob_error_code",
  "observed_host",
] as const;
const INTEGER_FIELDS = ["http_status"] as const;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}$/;

export function safeDiagnostic(err: unknown): string | null {
  if (!isApiError(err) || !err.details || typeof err.details !== "object" || Array.isArray(err.details)) return null;
  const details = err.details as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of TOKEN_FIELDS) {
    const value = details[key];
    if (typeof value === "string" && SAFE_TOKEN.test(value)) parts.push(`${key}=${value}`);
  }
  for (const key of INTEGER_FIELDS) {
    const value = details[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599)
      parts.push(`${key}=${value}`);
  }
  const codes = details.microsoft_codes;
  if (Array.isArray(codes)) {
    const safe = codes.filter((c): c is number => typeof c === "number" && Number.isInteger(c)).slice(0, 10);
    if (safe.length) parts.push(`microsoft_codes=${safe.join("|")}`);
  }
  return parts.length ? parts.join(";") : null;
}
