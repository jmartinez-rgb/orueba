import type { PerformanceQuery, NormalizedAccount } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import type { XlsxSheet } from "../../utils/xlsx.js";
import type { MetaClient } from "./client.js";
import { metaAccountId, metaId } from "./config.js";
import { insightsParams, insightsWindows } from "./queries.js";
import { metaNumber, metaObject, type MetaInsight } from "./types.js";
import { z } from "zod";

export type MetaActionGroup = "CAPI WhatsApp" | "Resto" | "Sin nombre";
export const actionGroup = (name: string | null): MetaActionGroup =>
  !name?.trim() ? "Sin nombre" : name.toLocaleLowerCase("en").includes("capi whatsapp") ? "CAPI WhatsApp" : "Resto";
export interface MetaActionRow {
  account_id: string;
  account_name: string;
  currency: string | null;
  timezone: string | null;
  group: MetaActionGroup;
  campaign_id: string;
  campaign_name: string | null;
  date: string;
  source_action: string;
  custom_name: string | null;
  event_source: string | null;
  count: number | null;
  value: number | null;
}
export interface MetaActionsRead {
  rows: MetaActionRow[];
  metadataAvailable: boolean;
}

/** Lists observed actions without selecting one, summing aliases or changing account configuration. */
export async function readMetaActions(
  client: MetaClient,
  account: NormalizedAccount,
  query: PerformanceQuery,
  signal: AbortSignal,
  onWarning?: (error: ApiError) => void,
): Promise<MetaActionsRead> {
  if (query.granularity !== "daily")
    throw new ApiError("INVALID_REQUEST", "El apoyo de acciones requiere datos diarios.");
  const id = metaAccountId(account.account_id);
  const names = new Map<string, { name: string | null; source: string | null }>();
  let metadataAvailable = true;
  try {
    const metadata = await client.list<Record<string, unknown>>(
      `act_${id}/customconversions`,
      {
        fields: "id,name,custom_event_type,event_source_type,is_archived",
      },
      signal,
    );
    for (const item of metadata) {
      const key = typeof item.id === "string" ? metaId(item.id) : null;
      if (!key || names.has(key))
        throw new ApiError("PROVIDER_ERROR", "Meta devolvió metadatos de acciones inválidos.");
      names.set(key, {
        name: typeof item.name === "string" ? item.name : null,
        source: typeof item.event_source_type === "string" ? item.event_source_type : null,
      });
    }
  } catch (error) {
    if (signal.aborted || !(error instanceof ApiError) || !["ACCESS_DENIED", "INVALID_REQUEST"].includes(error.code))
      throw error;
    metadataAvailable = false;
    names.clear();
    onWarning?.(new ApiError(error.code, "No se pudieron leer los nombres de conversiones personalizadas de Meta."));
  }
  const rows: MetaActionRow[] = [],
    seen = new Set<string>();
  for (const window of insightsWindows(query)) {
    const insights = await client.list<MetaInsight>(`act_${id}/insights`, insightsParams(window, true), signal);
    for (const row of insights) {
      if (
        typeof row.campaign_id !== "string" ||
        typeof row.date_start !== "string" ||
        !z.iso.date().safeParse(row.date_start).success ||
        row.date_stop !== row.date_start ||
        row.date_start < window.date_from ||
        row.date_start > window.date_to ||
        (row.account_id !== undefined && metaAccountId(row.account_id) !== id) ||
        (query.campaign_id && row.campaign_id !== query.campaign_id) ||
        (row.account_currency !== undefined && account.currency !== null && row.account_currency !== account.currency)
      )
        throw new ApiError("PROVIDER_ERROR", "Meta devolvió acciones de otro periodo o ámbito.");
      metaId(row.campaign_id);
      const key = `${row.campaign_id}/${row.date_start}`;
      if (seen.has(key)) throw new ApiError("PROVIDER_ERROR", "Meta repitió un periodo de acciones.");
      seen.add(key);
      const values = (raw: unknown) => {
        if (raw === undefined) return new Map<string, number | null>();
        if (!Array.isArray(raw)) throw new ApiError("PROVIDER_ERROR", "Meta devolvió acciones inválidas.");
        const out = new Map<string, number | null>();
        for (const action of raw) {
          if (!metaObject(action) || typeof action.action_type !== "string" || out.has(action.action_type))
            throw new ApiError("PROVIDER_ERROR", "Meta devolvió acciones inválidas o repetidas.");
          out.set(action.action_type, metaNumber(action.value));
        }
        return out;
      };
      const counts = values(row.actions),
        amounts = values(row.action_values);
      const campaignName = typeof row.campaign_name === "string" ? row.campaign_name : null;
      for (const source of new Set([...counts.keys(), ...amounts.keys()])) {
        const custom = /^offsite_conversion\.custom\.(\d+)$/.exec(source)?.[1];
        rows.push({
          account_id: id,
          account_name: account.account_name,
          currency: account.currency,
          timezone: account.timezone,
          group: actionGroup(campaignName),
          campaign_id: row.campaign_id,
          campaign_name: campaignName,
          date: row.date_start,
          source_action: source,
          custom_name: custom ? (names.get(custom)?.name ?? null) : null,
          event_source: custom ? (names.get(custom)?.source ?? null) : null,
          count: counts.get(source) ?? null,
          value: amounts.get(source) ?? null,
        });
        if (rows.length > 200000)
          throw new ApiError("PROVIDER_ERROR", "Meta excedió el límite del reporte de acciones.");
      }
    }
  }
  return { rows, metadataAvailable };
}

/** Account/group/action totals: action aliases remain separate, never a combined conversion total. */
export function actionTotals(rows: MetaActionRow[]) {
  const totals = new Map<string, MetaActionRow & { campaigns: Set<string>; days: Set<string> }>();
  for (const row of rows) {
    const key = JSON.stringify([row.account_id, row.currency, row.timezone, row.group, row.source_action]);
    const prior = totals.get(key);
    if (!prior) totals.set(key, { ...row, campaigns: new Set([row.campaign_id]), days: new Set([row.date]) });
    else {
      prior.count = prior.count === null || row.count === null ? null : prior.count + row.count;
      prior.value = prior.value === null || row.value === null ? null : prior.value + row.value;
      for (const value of [prior.count, prior.value])
        if (value !== null && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))
          throw new ApiError("PROVIDER_ERROR", "Los totales de Meta exceden la precisión admitida.");
      prior.campaigns.add(row.campaign_id);
      prior.days.add(row.date);
    }
  }
  return [...totals.values()];
}

export function metaActionSheets(rows: MetaActionRow[]): XlsxSheet[] {
  const identity = [
    "Cuenta ID",
    "Cuenta",
    "Moneda",
    "Zona",
    "Grupo",
    "Acción exacta",
    "Nombre personalizado",
    "Origen",
  ];
  return [
    {
      name: "Acciones por grupo",
      columns: [...identity, "Volumen observado", "Valor observado", "Campañas", "Días"].map((header) => ({
        header,
        width: 24,
      })),
      rows: actionTotals(rows).map((r) => [
        r.account_id,
        r.account_name,
        r.currency,
        r.timezone,
        r.group,
        r.source_action,
        r.custom_name,
        r.event_source,
        r.count,
        r.value,
        r.campaigns.size,
        r.days.size,
      ]),
    },
    {
      name: "Acciones por campaña",
      columns: [...identity, "Campaña ID", "Campaña", "Fecha", "Volumen observado", "Valor observado"].map(
        (header) => ({ header, width: 24 }),
      ),
      rows: rows.map((r) => [
        r.account_id,
        r.account_name,
        r.currency,
        r.timezone,
        r.group,
        r.source_action,
        r.custom_name,
        r.event_source,
        r.campaign_id,
        r.campaign_name,
        r.date,
        r.count,
        r.value,
      ]),
    },
  ];
}
