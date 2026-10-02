import type { MicrosoftFetch } from "./client.js";
import { isApiError } from "../../utils/errors.js";
import { MICROSOFT_REPORT_HOST, safeDownloadUrl, type MicrosoftResolver } from "./reports.js";

export type MicrosoftNetworkReason = "proxy_denied" | "dns_failed" | "tls_failed" | "timeout" | "connection_failed";

/** Classify fixed transport conditions only; original messages and signed URLs never leave this function. */
export function microsoftNetworkReason(error: unknown, signal?: AbortSignal): MicrosoftNetworkReason {
  if (signal?.aborted) return "timeout";
  if (
    isApiError(error) &&
    error.details &&
    typeof error.details === "object" &&
    "limitation" in error.details &&
    error.details.limitation === "report_download_dns"
  )
    return "dns_failed";
  let cause = error;
  const visited = new Set<unknown>();
  for (let n = 0; n < 8 && cause && typeof cause === "object" && !visited.has(cause); n++) {
    visited.add(cause);
    const row = cause as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown };
    const code = typeof row.code === "string" ? row.code : "";
    const message = typeof row.message === "string" ? row.message : "";
    if (/Proxy response.*\(403\)|CONNECT.*(?:403|denied|forbidden)|proxy.*(?:403|denied|forbidden)/i.test(message))
      return "proxy_denied";
    if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns_failed";
    if (/^(?:ERR_TLS_|CERT_|UNABLE_TO_VERIFY_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT)/.test(code))
      return "tls_failed";
    if (
      ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code) ||
      ["TimeoutError", "AbortError"].includes(String(row.name))
    )
      return "timeout";
    cause = row.cause;
  }
  return "connection_failed";
}

export interface MicrosoftNetworkCheck {
  host: typeof MICROSOFT_REPORT_HOST;
  reachable: boolean;
  http_status: number | null;
  reason: MicrosoftNetworkReason | null;
}

/** No signed URL, credentials, OAuth or report generation: only DNS and a HEAD through the normal TLS/proxy transport. */
export async function checkMicrosoftReportNetwork(
  request: MicrosoftFetch = fetch,
  resolve?: MicrosoftResolver,
  signal: AbortSignal = AbortSignal.timeout(15000),
): Promise<MicrosoftNetworkCheck> {
  const base = { host: MICROSOFT_REPORT_HOST, http_status: null } as const;
  try {
    signal.throwIfAborted();
    const url = await safeDownloadUrl(`https://${MICROSOFT_REPORT_HOST}/`, resolve);
    const response = await request(url, { method: "HEAD", redirect: "error", signal });
    await response.body?.cancel();
    // Any completed HTTP exchange establishes reachability. Root 403/404 is not evidence of valid report credentials.
    return { ...base, reachable: true, http_status: response.status, reason: null };
  } catch (error) {
    return { ...base, reachable: false, reason: microsoftNetworkReason(error, signal) };
  }
}
