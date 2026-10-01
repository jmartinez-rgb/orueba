import { setTimeout as delay } from "node:timers/promises";
import { ApiError } from "../../utils/errors.js";
import type { PerformanceQuery } from "../../types/normalized.js";
import { object, X_PLACEMENTS, xId } from "./config.js";
import type { XClient } from "./client.js";
const DAY = 86400000;
export function reportWindows(query: PerformanceQuery) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (
    !valid(query.date_from) ||
    !valid(query.date_to) ||
    query.date_from > query.date_to ||
    Date.parse(query.date_to) - Date.parse(query.date_from) > 365 * DAY ||
    !["daily", "hourly"].includes(query.granularity)
  )
    throw new ApiError("INVALID_REQUEST", "X Ads requiere fechas válidas y un rango máximo de 366 días.");
  const out: Array<{ from: string; to: string }> = [];
  for (let start = Date.parse(query.date_from), end = Date.parse(query.date_to); start <= end;) {
    const last = Math.min(end, start + 29 * DAY);
    out.push({ from: new Date(start).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10) });
    start = last + DAY;
  }
  return out;
}
/** Official analytics requires the CURRENT offset, even for historical dates. */
export function timezoneOffset(timezone: unknown, now = new Date()): number {
  if (typeof timezone !== "string" || !timezone)
    throw new ApiError("PROVIDER_ERROR", "X Ads no devolvió la zona horaria de la cuenta.");
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    if (offset === "GMT") return 0;
    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? "");
    if (!m) throw new Error();
    return (Number(m[2]) * 60 + Number(m[3])) * (m[1] === "-" ? -1 : 1);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una zona horaria inválida.");
  }
}
export interface XBucket {
  campaignId: string;
  date: string;
  hour: number | null;
  metrics: Record<string, number | null>;
  raw: Record<string, unknown>;
  offset: number;
}
function parseStats(
  body: Record<string, unknown>,
  ids: string[],
  from: string,
  to: string,
  hourly: boolean,
  offset: number,
  attribution: string,
) {
  const n = (Date.parse(to) - Date.parse(from) + DAY) / (hourly ? 3600000 : DAY);
  if (!Array.isArray(body.data) || body.time_series_length !== n)
    throw new ApiError("PROVIDER_ERROR", "X Ads devolvió un informe con una longitud incompatible.");
  const seen = new Set<string>();
  const out: XBucket[] = [];
  for (const row of body.data) {
    if (
      !object(row) ||
      typeof row.id !== "string" ||
      !ids.includes(row.id) ||
      seen.has(row.id) ||
      !Array.isArray(row.id_data) ||
      row.id_data.length !== 1
    )
      throw new ApiError("PROVIDER_ERROR", "X Ads devolvió entidades inválidas o segmentación inesperada.");
    seen.add(row.id);
    const data = row.id_data[0];
    if (!object(data) || data.segment != null || !object(data.metrics))
      throw new ApiError("PROVIDER_ERROR", "X Ads devolvió métricas incompatibles.");
    const series: Record<string, Array<number | null>> = Object.create(null);
    const ingest = (key: string, value: unknown) => {
      if (value === undefined) {
        series[key] = Array.from({ length: n }, () => null);
        return;
      }
      // X defines reported nulls as equivalent to the UI's zero activity.
      // Absent fields remain unknown; only explicitly returned nulls receive this default.
      if (value === null) {
        series[key] = Array.from({ length: n }, () => 0);
        return;
      }
      if (
        !Array.isArray(value) ||
        value.length !== n ||
        value.some(
          (v) => v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER),
        )
      )
        throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una serie numérica inválida.");
      series[key] = value.map((v) => (v === null ? 0 : v));
    };
    for (const [key, value] of Object.entries(data.metrics)) {
      if (!/^[a-z][a-z0-9_]{0,100}$/.test(key))
        throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una métrica inválida.");
      if (key.startsWith("conversion_")) {
        if (value === null) ingest(key, null);
        else if (object(value)) ingest(key, value[attribution]);
        else throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una conversión incompatible.");
      } else ingest(key, value);
    }
    for (let i = 0; i < n; i++) {
      const time = new Date(Date.parse(from) + i * (hourly ? 3600000 : DAY));
      const metrics: Record<string, number | null> = Object.create(null);
      for (const [key, values] of Object.entries(series)) metrics[key] = values[i] ?? null;
      const raw: Record<string, unknown> = Object.create(null);
      for (const [key, value] of Object.entries(data.metrics)) {
        if (object(value)) {
          const action: Record<string, unknown> = Object.create(null);
          for (const [attribute, values] of Object.entries(value)) {
            if (!/^[a-z][a-z0-9_]{0,80}$/.test(attribute))
              throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una atribución inválida.");
            if (values === null) action[attribute] = null;
            else if (
              Array.isArray(values) &&
              values.length === n &&
              values.every(
                (v) =>
                  v === null || (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER),
              )
            )
              action[attribute] = values[i];
            else throw new ApiError("PROVIDER_ERROR", "X Ads devolvió una serie de atribución inválida.");
          }
          raw[key] = action;
        } else raw[key] = Array.isArray(value) ? value[i] : null;
      }
      out.push({
        campaignId: row.id,
        date: time.toISOString().slice(0, 10),
        hour: hourly ? time.getUTCHours() : null,
        metrics,
        raw,
        offset,
      });
    }
  }
  if (ids.some((id) => !seen.has(id)))
    throw new ApiError("PROVIDER_ERROR", "X Ads omitió entidades del informe; no se presume actividad cero.");
  return out;
}
export async function xReport(
  client: XClient,
  account: Record<string, unknown>,
  ids: string[],
  query: PerformanceQuery,
  conversions: boolean,
  signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = (ms, s) => delay(ms, undefined, { signal: s }),
) {
  const windows = reportWindows(query),
    accountId = xId(account.id),
    offset = timezoneOffset(account.timezone);
  const days = (Date.parse(query.date_to) - Date.parse(query.date_from)) / DAY + 1;
  const asynchronous = client.config.reportMode === "async" || (client.config.reportMode === "auto" && days > 7);
  if (client.config.reportMode === "sync" && days > 7)
    throw new ApiError("INVALID_REQUEST", "X Ads requiere informes asíncronos para rangos mayores de siete días.");
  if (
    typeof account.timezone_switch_at === "string" &&
    Date.parse(query.date_from) - offset * 60000 <= Date.parse(account.timezone_switch_at)
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "El rango atraviesa el cambio histórico de zona de X Ads y requiere conciliación específica.",
    );
  const results: XBucket[] = [];
  for (const window of windows)
    for (let pos = 0; pos < ids.length; pos += 20) {
      const batch = ids.slice(pos, pos + 20),
        merged = new Map<string, XBucket>();
      for (const placement of X_PLACEMENTS) {
        const params = {
          entity: "CAMPAIGN",
          entity_ids: batch.join(","),
          start_time: new Date(Date.parse(window.from) - offset * 60000).toISOString().replace(".000Z", "Z"),
          end_time: new Date(Date.parse(window.to) + DAY - offset * 60000).toISOString().replace(".000Z", "Z"),
          granularity: query.granularity === "hourly" ? "HOUR" : "DAY",
          metric_groups: conversions ? "WEB_CONVERSION" : "ENGAGEMENT,BILLING,VIDEO",
          placement,
        };
        let body: Record<string, unknown>;
        if (!asynchronous) body = await client.call(`/stats/accounts/${accountId}`, params, signal);
        else {
          const path = `/stats/jobs/accounts/${accountId}`;
          const created = await client.call(path, params, signal, "POST");
          if (
            !object(created.data) ||
            typeof created.data.id_str !== "string" ||
            !/^\d{1,30}$/.test(created.data.id_str)
          )
            throw new ApiError("PROVIDER_ERROR", "X Ads no devolvió un identificador de trabajo válido.");
          const jobId = created.data.id_str;
          let job = created.data;
          for (let poll = 0; job.status !== "SUCCESS"; poll++) {
            if (!["PROCESSING", "QUEUED"].includes(String(job.status)))
              throw new ApiError("PROVIDER_ERROR", "X Ads no pudo generar el informe asíncrono.");
            if (poll >= 120)
              throw new ApiError("PROVIDER_TIMEOUT", "X Ads no completó el informe asíncrono dentro del límite.");
            await wait(1000, signal);
            signal.throwIfAborted();
            const pending = await client.call(path, { job_ids: jobId }, signal);
            if (
              !Array.isArray(pending.data) ||
              pending.data.length !== 1 ||
              !object(pending.data[0]) ||
              pending.data[0].id_str !== jobId
            )
              throw new ApiError("PROVIDER_ERROR", "X Ads devolvió un trabajo distinto al solicitado.");
            job = pending.data[0];
          }
          body = await client.download(job.url, signal, jobId);
        }
        const echo = object(body.request) && object(body.request.params) ? body.request.params : null;
        if (
          body.data_type !== "stats" ||
          !echo ||
          Date.parse(String(echo.start_time)) !== Date.parse(params.start_time) ||
          Date.parse(String(echo.end_time)) !== Date.parse(params.end_time) ||
          echo.granularity !== params.granularity ||
          echo.entity !== "CAMPAIGN" ||
          echo.placement !== placement ||
          (echo.account_id != null && echo.account_id !== accountId)
        )
          throw new ApiError("PROVIDER_ERROR", "X Ads devolvió un informe de otro rango o ámbito.");
        for (const bucket of parseStats(
          body,
          batch,
          window.from,
          window.to,
          query.granularity === "hourly",
          offset,
          client.config.attribution,
        )) {
          const key = `${bucket.campaignId}/${bucket.date}/${bucket.hour}`,
            prior = merged.get(key);
          if (!prior) merged.set(key, { ...bucket, raw: { [placement]: bucket.raw } });
          else {
            for (const metric of new Set([...Object.keys(prior.metrics), ...Object.keys(bucket.metrics)])) {
              const a = prior.metrics[metric],
                b = bucket.metrics[metric],
                sum = a == null || b == null ? null : a + b;
              if (sum !== null && (!Number.isFinite(sum) || sum > Number.MAX_SAFE_INTEGER))
                throw new ApiError("PROVIDER_ERROR", "X Ads excedió la precisión numérica admitida.");
              prior.metrics[metric] = sum;
            }
            prior.raw[placement] = bucket.raw;
          }
        }
      }
      results.push(...merged.values());
      if (results.length > 200000) throw new ApiError("PROVIDER_ERROR", "X Ads superó el tamaño seguro del informe.");
    }
  return results;
}
