import { ApiError } from "../../utils/errors.js";
import type { PerformanceQuery } from "../../types/normalized.js";
import { object, spotifyId } from "./config.js";
import type { SpotifyClient } from "./client.js";
import { rows, vendorId } from "./accounts.js";

const DAY = 86400000;
export function reportRanges(query: PerformanceQuery, now = Date.now()) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (
    !valid(query.date_from) ||
    !valid(query.date_to) ||
    query.date_from > query.date_to ||
    Date.parse(query.date_to) - Date.parse(query.date_from) > 365 * DAY ||
    !["daily", "hourly"].includes(query.granularity)
  )
    throw new ApiError("INVALID_REQUEST", "Spotify requiere fechas válidas, ordenadas y un rango máximo de 366 días.");
  if (query.date_to > new Date(now).toISOString().slice(0, 10))
    throw new ApiError("INVALID_REQUEST", "Spotify no admite informes de fechas futuras.");
  if (query.granularity === "hourly" && Date.parse(query.date_from) < now - 14 * DAY)
    throw new ApiError("INVALID_REQUEST", "Spotify solo ofrece informes por hora dentro de las últimas dos semanas.", {
      details: { provider: "spotify", limitation: "hourly_retention" },
    });
  const out: Array<{ from: string; to: string }> = [];
  for (let start = Date.parse(query.date_from), end = Date.parse(query.date_to); start <= end;) {
    const last = Math.min(end, start + 89 * DAY);
    out.push({ from: new Date(start).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10) });
    start = last + DAY;
  }
  return out;
}
export async function spotifyCampaigns(client: SpotifyClient, accountId: string, signal: AbortSignal) {
  const result: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let page = 0, offset = 0; page < 2000; page++) {
    const body = await client.get(
      `/ad_accounts/${spotifyId(accountId)}/campaigns`,
      new URLSearchParams({ limit: "50", offset: String(offset), sort_field: "ID", sort_direction: "ASC" }),
      signal,
    );
    const items = rows(body.campaigns);
    if (items.length > 50) throw new ApiError("PROVIDER_ERROR", "Spotify excedió el tamaño de página de campañas.");
    const paging = body.paging;
    if (
      paging != null &&
      (!object(paging) ||
        (paging.offset != null && paging.offset !== offset) ||
        (paging.total_results != null &&
          (!Number.isSafeInteger(paging.total_results) || Number(paging.total_results) < 0)))
    )
      throw new ApiError("PROVIDER_ERROR", "Spotify devolvió paginación de campañas incompatible.");
    for (const item of items) {
      const id = vendorId(item.id);
      if (seen.has(id)) throw new ApiError("PROVIDER_ERROR", "Spotify repitió una campaña durante la paginación.");
      seen.add(id);
      result.push(item);
    }
    offset += items.length;
    const total = object(paging) && typeof paging.total_results === "number" ? paging.total_results : null;
    if (total !== null && offset > total)
      throw new ApiError("PROVIDER_ERROR", "Spotify devolvió más campañas que el total declarado.");
    if (total !== null && offset === total) return result;
    if (items.length < 50) {
      if (total !== null && offset < total)
        throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una lista de campañas incompleta.");
      return result;
    }
  }
  throw new ApiError("PROVIDER_ERROR", "Spotify superó el límite seguro de paginación de campañas.");
}
export async function spotifyReport(
  client: SpotifyClient,
  accountId: string,
  query: PerformanceQuery,
  fields: string[],
  signal: AbortSignal,
  onWarning: (e: ApiError) => void,
) {
  const out: Record<string, unknown>[] = [];
  const id = spotifyId(accountId);
  const ranges = reportRanges(query);
  // DAY/HOUR require explicit entity IDs. The official endpoint permits at most 50 per request.
  const campaigns = query.campaign_id
    ? [spotifyId(query.campaign_id)]
    : (await spotifyCampaigns(client, id, signal)).map((row) => vendorId(row.id));
  if (campaigns.length > 10000)
    throw new ApiError("PROVIDER_ERROR", "Spotify excedió el límite de campañas del informe; filtra una campaña.");
  for (let index = 0; index < campaigns.length; index += 50) {
    const batch = campaigns.slice(index, index + 50);
    const allowed = new Set(batch);
    for (const range of ranges) {
      const initial = new URLSearchParams({
        entity_type: "CAMPAIGN",
        report_start: range.from + "T00:00:00Z",
        report_end: range.to + (query.granularity === "hourly" ? "T23:00:00Z" : "T00:00:00Z"),
        granularity: query.granularity === "hourly" ? "HOUR" : "DAY",
        limit: "50",
        entity_ids_type: "CAMPAIGN",
      });
      for (const field of [...new Set(fields)]) initial.append("fields", field);
      for (const campaign of batch) initial.append("entity_ids", campaign);
      let params = initial;
      const seen = new Set<string>();
      let finished = false;
      for (let page = 0; page < 4000; page++) {
        const body = await client.get(`/ad_accounts/${id}/aggregate_reports`, params, signal);
        if (body.granularity !== (query.granularity === "hourly" ? "HOUR" : "DAY"))
          throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una granularidad distinta a la solicitada.");
        const items = rows(body.rows);
        if (items.length > 50) throw new ApiError("PROVIDER_ERROR", "Spotify excedió el tamaño de página de informes.");
        for (const row of items) {
          if (
            row.entity_type !== "CAMPAIGN" ||
            !allowed.has(vendorId(row.entity_id)) ||
            typeof row.start_time !== "string" ||
            row.start_time.slice(0, 10) < range.from ||
            row.start_time.slice(0, 10) > range.to
          )
            throw new ApiError("PROVIDER_ERROR", "Spotify devolvió datos fuera del bloque de fechas solicitado.");
          out.push(row);
        }
        if (body.warnings != null && !Array.isArray(body.warnings))
          throw new ApiError("PROVIDER_ERROR", "Spotify devolvió advertencias incompatibles.");
        if (Array.isArray(body.warnings) && body.warnings.length)
          onWarning(
            new ApiError(
              "PROVIDER_ERROR",
              "Spotify incluyó advertencias en el informe; revisa las limitaciones antes de sumar los datos.",
              {
                details: {
                  provider: "spotify",
                  account_id: id,
                  limitation: "reporting_warning",
                  warning_count: body.warnings.length,
                },
              },
            ),
          );
        if (out.length > 200000)
          throw new ApiError("PROVIDER_ERROR", "El informe de Spotify supera el tamaño admitido.");
        const token = body.continuation_token;
        if (token == null || token === "") {
          finished = true;
          break;
        }
        if (typeof token !== "string" || token.length > 16384 || /[\r\n]/.test(token) || seen.has(token))
          throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una continuación inválida o repetida.");
        seen.add(token);
        // Spotify explicitly requires the continuation token alone, without even fields or limit.
        params = new URLSearchParams({ continuation_token: token });
      }
      if (!finished) throw new ApiError("PROVIDER_ERROR", "Spotify superó el límite seguro de paginación de informes.");
    }
  }
  return out;
}
