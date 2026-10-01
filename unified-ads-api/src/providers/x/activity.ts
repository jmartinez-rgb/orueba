import { ApiError } from "../../utils/errors.js";
import type { PerformanceQuery } from "../../types/normalized.js";
import type { XClient } from "./client.js";
import { object, X_ALLOWED_PLACEMENTS } from "./config.js";
import { timezoneOffset } from "./reports.js";

/** Active entities is a change-log window, never evidence of complete historical campaign coverage. */
export async function incrementalCampaignIds(
  client: XClient,
  account: Record<string, unknown>,
  ids: string[],
  query: PerformanceQuery,
  signal: AbortSignal,
  onWarning?: (error: ApiError) => void,
): Promise<string[]> {
  const window = client.config.activityWindow;
  if (!window || query.campaign_id || !ids.length) return ids;
  const warn = (partial: boolean) =>
    onWarning?.(
      new ApiError(
        "PROVIDER_ERROR",
        partial
          ? "La lectura incremental de X contiene solo campañas con cambios; no es un informe histórico completo."
          : "No se pudo aplicar el filtro incremental de X; se consultan todas las campañas del ámbito.",
        {
          details: {
            provider: "x",
            limitation: partial ? "incremental_coverage" : "active_entities_fallback",
            partial_data: partial,
          },
        },
      ),
    );
  try {
    const body = await client.call(
      `/stats/accounts/${String(account.id)}/active_entities`,
      {
        entity: "CAMPAIGN",
        start_time: window.start,
        end_time: window.end,
      },
      signal,
    );
    const echo = object(body.request) && object(body.request.params) ? body.request.params : null;
    if (
      body.data_type !== "active_entities" ||
      !echo ||
      echo.entity !== "CAMPAIGN" ||
      Date.parse(String(echo.start_time)) !== Date.parse(window.start) ||
      Date.parse(String(echo.end_time)) !== Date.parse(window.end) ||
      (echo.account_id !== undefined && echo.account_id !== account.id) ||
      !Array.isArray(body.data) ||
      body.data.length > 200000 ||
      ![undefined, null, "", "0"].includes(body.next_cursor as undefined | null | string)
    )
      throw new Error();
    const offset = timezoneOffset(account.timezone) * 60000;
    const start = Date.parse(query.date_from) - offset,
      end = Date.parse(query.date_to) + 86400000 - offset;
    const seen = new Set<string>(),
      selected = new Set<string>(),
      allowed = new Set(ids);
    const timestamp = (value: unknown) => {
      if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
        throw new Error();
      const time = Date.parse(value);
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error();
      return time;
    };
    for (const row of body.data) {
      if (
        !object(row) ||
        typeof row.entity_id !== "string" ||
        !allowed.has(row.entity_id) ||
        seen.has(row.entity_id) ||
        !Array.isArray(row.placements) ||
        !row.placements.length ||
        row.placements.some(
          (p) =>
            typeof p !== "string" ||
            !(X_ALLOWED_PLACEMENTS as readonly string[]).includes(p) ||
            !client.config.placements.includes(p as (typeof client.config.placements)[number]),
        )
      )
        throw new Error();
      seen.add(row.entity_id);
      const from = timestamp(row.activity_start_time),
        to = timestamp(row.activity_end_time);
      if (from > to) throw new Error();
      if (from < end && to >= start) selected.add(row.entity_id);
    }
    // Empty and disjoint windows do not prove zero activity; retain the complete baseline read.
    if (!selected.size) throw new Error();
    warn(true);
    return ids.filter((id) => selected.has(id));
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof ApiError &&
        ["AUTH_ERROR", "ACCESS_REQUIRED", "RATE_LIMITED", "PROVIDER_TIMEOUT"].includes(error.code))
    )
      throw error;
    warn(false);
    return ids;
  }
}
