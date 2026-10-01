import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { unzipSync } from "fflate";
import { parse } from "csv-parse/sync";
import type { NormalizedAccount, PerformanceQuery } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { microsoftId, object } from "./config.js";
import { responseBytes, type MicrosoftClient } from "./client.js";

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

export async function safeDownloadUrl(
  value: string,
  resolve: MicrosoftResolver = (hostname) => lookup(hostname, { all: true }),
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una URL de descarga inválida.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !url.hostname.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) ||
    isIP(url.hostname) ||
    url.hostname.startsWith("[")
  )
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una URL de descarga no admitida.");
  let addresses;
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "No se pudo resolver el servidor de informes de Microsoft.");
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
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió un servidor de descarga no público.");
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
  const submit = await client.call("submit", { ReportRequest: request }, signal, account);
  if (typeof submit.ReportRequestId !== "string" || !submit.ReportRequestId || submit.ReportRequestId.length > 2048)
    throw new ApiError("PROVIDER_ERROR", "Microsoft no devolvió el identificador del informe.");
  for (;;) {
    signal.throwIfAborted();
    const poll = await client.call("poll", { ReportRequestId: submit.ReportRequestId }, signal, account);
    const status = poll.ReportRequestStatus;
    if (!object(status)) throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió un estado de informe inválido.");
    if (status.Status === "Pending") {
      await client.wait(signal);
      continue;
    }
    if (status.Status !== "Success")
      throw new ApiError("PROVIDER_ERROR", "Microsoft no pudo generar el informe solicitado.");
    if (status.ReportDownloadUrl == null) return []; // Officially indicates a successful report with no data.
    if (typeof status.ReportDownloadUrl !== "string")
      throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una descarga inválida.");
    const url = await safeDownloadUrl(status.ReportDownloadUrl, resolve);
    let response: Response;
    try {
      // The signed URL is issued by Microsoft; its domain may change. No credentials or redirects are used.
      response = await client.request(url, { method: "GET", signal, redirect: "error" });
    } catch {
      throw new ApiError(
        signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
        "No se pudo descargar el informe de Microsoft.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError("PROVIDER_ERROR", "Microsoft no permitió descargar el informe.");
    }
    const data = parseReport(await responseBytes(response, 10 * 1024 * 1024, signal), request.Columns);
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
