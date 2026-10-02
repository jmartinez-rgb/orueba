import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { unzipSync } from "fflate";
import { parse } from "csv-parse/sync";
import type { NormalizedAccount, PerformanceQuery } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { microsoftId, object } from "./config.js";
import { responseBytes, type MicrosoftClient } from "./client.js";
import { microsoftNetworkReason } from "./network.js";

export const PERFORMANCE_COLUMNS = [
  "TimePeriod",
  "AccountId",
  "CampaignId",
  "CampaignName",
  "CampaignStatus",
  "CurrencyCode",
  "Spend",
  "Impressions",
  "Clicks",
  "ConversionsQualified",
  "Revenue",
];
export const CONVERSION_COLUMNS = [
  "TimePeriod",
  "AccountId",
  "CampaignId",
  "GoalId",
  "Goal",
  "GoalType",
  "ConversionsQualified",
  "Revenue",
  "AllConversionsQualified",
  "AllRevenue",
];
export type ReportRow = Record<string, string>;
export type MicrosoftResolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

// Trust only the Microsoft reporting storage account observed in an authenticated v13 response.
// Allowing arbitrary public hosts permits attacker-controlled DNS to change after validation.
// A vendor hostname migration must be reviewed; do not expand this to all Azure storage tenants.
export const MICROSOFT_REPORT_HOST = "bingadsappsstorageprod.blob.core.windows.net";

const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(ip, prefix, "ipv6");

export type MicrosoftReportStage =
  "report_submit" | "report_poll" | "report_status" | "report_download_url" | "report_download" | "report_parse";
const safeToken = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : "UNRECOGNIZED";
const safeHost = (hostname: string) =>
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname) &&
  !isIP(hostname)
    ? { observed_host: hostname }
    : {};
/** Adds the failing report stage to a provider error; every stage still surfaces as PROVIDER_ERROR/502. */
function staged(error: unknown, stage: MicrosoftReportStage): never {
  if (error instanceof ApiError) {
    const details = object(error.details) ? error.details : {};
    throw new ApiError(error.code, error.message, {
      details: { provider: "microsoft", ...details, stage },
      statusCode: error.statusCode,
      retryAfter: error.retryAfter,
    });
  }
  throw error;
}
const failure = (message: string, stage: MicrosoftReportStage, extra: Record<string, unknown> = {}) =>
  new ApiError("PROVIDER_ERROR", message, { details: { provider: "microsoft", stage, ...extra } });

export async function safeDownloadUrl(
  value: string,
  resolve: MicrosoftResolver = (hostname) => lookup(hostname, { all: true }),
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una URL de descarga inválida.", {
      details: { provider: "microsoft", limitation: "report_download_url_invalid" },
    });
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== MICROSOFT_REPORT_HOST ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !url.hostname.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) ||
    isIP(url.hostname) ||
    url.hostname.startsWith("[")
  )
    // The hostname (never path or signed query) tells whether Microsoft moved its storage account.
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una URL de descarga no admitida.", {
      details: {
        provider: "microsoft",
        limitation:
          url.protocol === "https:" && url.hostname !== MICROSOFT_REPORT_HOST
            ? "report_download_host_unexpected"
            : "report_download_url_unsafe",
        ...(url.protocol === "https:" ? safeHost(url.hostname) : {}),
      },
    });
  let addresses;
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "No se pudo resolver el servidor de informes de Microsoft.", {
      details: { provider: "microsoft", limitation: "report_download_dns" },
    });
  }
  if (
    !addresses.length ||
    addresses.some(
      (a) =>
        ![4, 6].includes(a.family) ||
        !isIP(a.address) ||
        // Block mapped IPv4 too, rather than treating it as an unrelated public IPv6 address.
        (a.family === 6 && /^(?:0*:)*ffff:/i.test(a.address)) ||
        blocked.check(a.address, a.family === 4 ? "ipv4" : "ipv6"),
    )
  )
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió un servidor de descarga no público.", {
      details: { provider: "microsoft", limitation: "report_download_address_not_public" },
    });
  return url;
}

export function reportRequest(query: PerformanceQuery, accountId: string, conversions: boolean, completeData: boolean) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(query.date_from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(query.date_to) ||
    !Number.isFinite(Date.parse(query.date_from)) ||
    !Number.isFinite(Date.parse(query.date_to)) ||
    new Date(query.date_from).toISOString().slice(0, 10) !== query.date_from ||
    new Date(query.date_to).toISOString().slice(0, 10) !== query.date_to ||
    query.date_from > query.date_to ||
    Date.parse(query.date_to) - Date.parse(query.date_from) > 365 * 86400000 ||
    !["daily", "hourly"].includes(query.granularity)
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "Microsoft requiere fechas válidas, ordenadas y un rango máximo de 366 días.",
    );
  const date = (s: string) => {
    const [Year, Month, Day] = s.split("-").map(Number);
    return { Day, Month, Year };
  };
  const id = microsoftId(accountId);
  return {
    Type: conversions ? "ConversionPerformanceReportRequest" : "CampaignPerformanceReportRequest",
    Format: "Csv",
    FormatVersion: "2.0",
    ReportName: "Unified Ads Monitoring",
    ExcludeReportHeader: true,
    ExcludeReportFooter: true,
    ExcludeColumnHeaders: false,
    ReturnOnlyCompleteData: completeData,
    Aggregation: query.granularity === "hourly" ? "Hourly" : "Daily",
    Columns: conversions ? [...CONVERSION_COLUMNS] : [...PERFORMANCE_COLUMNS],
    Scope: query.campaign_id
      ? { Campaigns: [{ AccountId: id, CampaignId: microsoftId(query.campaign_id) }] }
      : { AccountIds: [id] },
    // Microsoft's downloaded rows are UTC. ReportTimeZone only affects relative periods, not row conversion.
    Time: { CustomDateRangeStart: date(query.date_from), CustomDateRangeEnd: date(query.date_to) },
  };
}
export function parseReport(archive: Uint8Array, columns: string[]): ReportRow[] {
  try {
    let total = 0;
    const entries = unzipSync(archive, {
      filter: (file) => {
        total += file.originalSize;
        if (!Number.isSafeInteger(total) || total > 25 * 1024 * 1024) throw new Error();
        return true;
      },
    });
    const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
    if (files.length !== 1 || !/\.csv$/i.test(files[0]![0])) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(files[0]![1]);
    let headerSeen = false;
    const data: ReportRow[] = parse(text, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 1024 * 1024,
      columns: (header: string[]) => {
        if (new Set(header).size !== header.length || columns.some((c) => !header.includes(c))) throw new Error();
        headerSeen = true;
        return header;
      },
    });
    if (!headerSeen || data.length > 250000) throw new Error();
    return data;
  } catch {
    throw new ApiError(
      "PROVIDER_ERROR",
      "Microsoft devolvió un informe ZIP/CSV inválido, incompleto o demasiado grande.",
    );
  }
}

export async function microsoftReport(
  client: MicrosoftClient,
  query: PerformanceQuery,
  account: NormalizedAccount,
  conversions: boolean,
  signal: AbortSignal,
  resolve?: MicrosoftResolver,
  onWarning?: (e: ApiError) => void,
): Promise<ReportRow[]> {
  const request = reportRequest(query, account.account_id, conversions, client.config.completeData);
  const submit = await client
    .call("submit", { ReportRequest: request }, signal, account)
    .catch((e: unknown) => staged(e, "report_submit"));
  if (typeof submit.ReportRequestId !== "string" || !submit.ReportRequestId || submit.ReportRequestId.length > 2048)
    throw failure("Microsoft no devolvió el identificador del informe.", "report_submit", {
      limitation: "report_id_missing",
    });
  for (;;) {
    signal.throwIfAborted();
    const poll = await client
      .call("poll", { ReportRequestId: submit.ReportRequestId }, signal, account)
      .catch((e: unknown) => staged(e, "report_poll"));
    const status = poll.ReportRequestStatus;
    if (!object(status))
      throw failure("Microsoft devolvió un estado de informe inválido.", "report_poll", {
        limitation: "report_status_invalid",
      });
    if (status.Status === "Pending") {
      await client.wait(signal);
      continue;
    }
    if (status.Status !== "Success")
      throw failure("Microsoft no pudo generar el informe solicitado.", "report_status", {
        report_status: safeToken(status.Status),
      });
    if (status.ReportDownloadUrl == null) return []; // Officially indicates a successful report with no data.
    if (typeof status.ReportDownloadUrl !== "string")
      throw failure("Microsoft devolvió una descarga inválida.", "report_download_url", {
        limitation: "report_download_url_invalid",
      });
    const url = await safeDownloadUrl(status.ReportDownloadUrl, resolve).catch((e: unknown) =>
      staged(e, "report_download_url"),
    );
    let response: Response;
    try {
      // Fixed trusted Microsoft host; preserve the configured proxy and TLS verification.
      response = await client.request(url, { method: "GET", signal, redirect: "error" });
    } catch (error) {
      throw new ApiError(
        signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
        "No se pudo descargar el informe de Microsoft; comprueba la salida de red al servidor de informes con npm run microsoft:red.",
        {
          details: {
            provider: "microsoft",
            stage: "report_download",
            limitation: "report_download_network",
            report_host: MICROSOFT_REPORT_HOST,
            network_reason: microsoftNetworkReason(error, signal),
          },
        },
      );
    }
    if (!response.ok) {
      // Azure Storage names the rejection (for example an expired signature) in x-ms-error-code.
      const blob = response.headers.get("x-ms-error-code");
      await response.body?.cancel();
      throw failure("Microsoft no permitió descargar el informe.", "report_download", {
        limitation: "report_download_rejected",
        http_status: response.status,
        ...(blob ? { blob_error_code: safeToken(blob) } : {}),
        transient: response.status >= 500 || response.status === 429,
      });
    }
    const bytes = await responseBytes(response, 10 * 1024 * 1024, signal).catch((e: unknown) =>
      staged(e, "report_download"),
    );
    let data: ReportRow[];
    try {
      data = parseReport(bytes, request.Columns);
    } catch (e) {
      staged(e, "report_parse");
    }
    if (!client.config.completeData)
      onWarning?.(
        new ApiError(
          "PROVIDER_ERROR",
          "El informe de Microsoft puede incluir datos aún en procesamiento; no se exigió un cierre completo.",
          { details: { provider: "microsoft", account_id: account.account_id, limitation: "provisional_reporting" } },
        ),
      );
    return data;
  }
}
