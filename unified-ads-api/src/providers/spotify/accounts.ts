import type { NormalizedAccount } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { object, spotifyId, type SpotifyConfig } from "./config.js";
import type { SpotifyClient } from "./client.js";
import { spotifyAccountWarning } from "./errors.js";

export function vendorId(value: unknown): string {
  try {
    return spotifyId(value);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió un identificador inválido.");
  }
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 10000 || !value.every(object))
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una lista incompatible o demasiado grande.");
  return value;
}
export function normalizeAccount(row: Record<string, unknown>, config: SpotifyConfig): NormalizedAccount {
  const id = vendorId(row.id);
  if (typeof row.name !== "string" || !row.name.trim())
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una cuenta sin nombre.");
  if (row.currency_code != null && (typeof row.currency_code !== "string" || !/^[A-Z]{3}$/.test(row.currency_code)))
    throw new ApiError("PROVIDER_ERROR", "Spotify devolvió una moneda inválida.");
  return {
    platform: "spotify",
    client_id: config.clientMapping[id] ?? null,
    account_id: id,
    account_name: row.name,
    currency: typeof row.currency_code === "string" ? row.currency_code : null,
    timezone: null, // Account timezone is not in the contract. Reporting timestamps are explicitly UTC.
    status: typeof row.status === "string" ? row.status : null,
    manager_account_id: row.business_id == null ? null : vendorId(row.business_id),
  };
}
export async function readSpotifyAccount(client: SpotifyClient, id: string, signal: AbortSignal) {
  const body = await client.get(`/ad_accounts/${spotifyId(id)}`, new URLSearchParams(), signal);
  const account = normalizeAccount(body, client.config);
  if (account.account_id !== spotifyId(id)) throw new ApiError("PROVIDER_ERROR", "Spotify devolvió otra cuenta.");
  return account;
}
export async function discoverSpotifyAccounts(
  client: SpotifyClient,
  signal: AbortSignal,
  onWarning: (e: ApiError) => void,
) {
  const output: NormalizedAccount[] = [];
  let first: ApiError | null = null;
  if (client.config.accountIds.length) {
    for (const id of client.config.accountIds) {
      try {
        output.push(await readSpotifyAccount(client, id, signal));
      } catch (err) {
        const warning = spotifyAccountWarning(err, id);
        if (!warning) throw err;
        first ??= warning;
        onWarning(warning);
      }
    }
    if (!output.length && first) throw first;
    return output;
  }
  let businesses = client.config.businessIds;
  if (!businesses.length) {
    const body = await client.get("/businesses", new URLSearchParams(), signal);
    businesses = rows(body.businesses).map((r) => vendorId(r.id));
    if (new Set(businesses).size !== businesses.length)
      throw new ApiError("PROVIDER_ERROR", "Spotify repitió un negocio.");
  }
  const seen = new Map<string, NormalizedAccount>();
  let success = 0;
  for (const id of businesses) {
    let body: Record<string, unknown>;
    try {
      body = await client.get(`/businesses/${id}/ad_accounts`, new URLSearchParams(), signal);
      success++;
    } catch (err) {
      const warning = spotifyAccountWarning(err, id);
      if (!warning) throw err;
      const businessWarning = new ApiError(warning.code, warning.message, {
        details: { provider: "spotify", business_id: id },
      });
      first ??= businessWarning;
      onWarning(businessWarning);
      continue;
    }
    const local = new Set<string>();
    for (const row of rows(body.ad_accounts)) {
      const account = normalizeAccount(row, client.config);
      if (local.has(account.account_id)) throw new ApiError("PROVIDER_ERROR", "Spotify repitió una cuenta.");
      local.add(account.account_id);
      const previous = seen.get(account.account_id);
      if (
        previous &&
        (previous.currency !== account.currency || previous.manager_account_id !== account.manager_account_id)
      )
        throw new ApiError("PROVIDER_ERROR", "Spotify devolvió datos contradictorios para una cuenta.");
      if (!previous) {
        seen.set(account.account_id, account);
        output.push(account);
      }
      if (output.length > 10000)
        throw new ApiError("PROVIDER_ERROR", "Spotify excedió el límite de cuentas de una consulta.");
    }
  }
  if (!success && first) throw first;
  return output;
}
