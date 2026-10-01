import type { NormalizedAccount } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import type { TikTokClient } from "./client.js";
import { tiktokId } from "./config.js";
import { ACCOUNT_FIELDS } from "./queries.js";
import { normalizeAccount } from "./normalize.js";
import { tiktokAccountWarning } from "./errors.js";
import type { TikTokAccount } from "./types.js";

export async function authorizedAdvertisers(client: TikTokClient, signal: AbortSignal): Promise<string[]> {
  if (client.config.advertiserIds.length) return [...client.config.advertiserIds];
  const data = await client.get("oauth2/advertiser/get/", {}, signal);
  const rows = client.rows<{ advertiser_id?: string }>(data);
  try {
    return [...new Set(rows.map((row) => tiktokId(row.advertiser_id ?? "")))];
  } catch {
    throw new ApiError("PROVIDER_ERROR", "TikTok devolvió cuentas autorizadas con IDs inválidos.");
  }
}
export async function readTikTokAccount(
  client: TikTokClient,
  id: string,
  signal: AbortSignal,
): Promise<NormalizedAccount> {
  const data = await client.get(
    "advertiser/info/",
    { advertiser_ids: JSON.stringify([tiktokId(id)]), fields: JSON.stringify(ACCOUNT_FIELDS) },
    signal,
  );
  const rows = client.rows<TikTokAccount>(data);
  if (rows.length === 0)
    throw new ApiError("ACCESS_DENIED", "TikTok no devolvió información de la cuenta solicitada.", {
      details: { provider: "tiktok", account_id: id },
    });
  if (rows.length !== 1) throw new ApiError("PROVIDER_ERROR", "TikTok devolvió más cuentas de las solicitadas.");
  const account = normalizeAccount(rows[0]!, client.config);
  if (account.account_id !== id) throw new ApiError("PROVIDER_ERROR", "TikTok devolvió otra cuenta.");
  return account;
}
export async function discoverTikTokAccounts(
  client: TikTokClient,
  signal: AbortSignal,
  onWarning: (error: ApiError) => void,
): Promise<NormalizedAccount[]> {
  const result: NormalizedAccount[] = [];
  let first: ApiError | null = null;
  for (const id of await authorizedAdvertisers(client, signal)) {
    try {
      result.push(await readTikTokAccount(client, id, signal));
    } catch (err) {
      const warning = tiktokAccountWarning(err, id);
      if (!warning) throw err;
      first ??= warning;
      onWarning(warning);
    }
  }
  if (!result.length && first) throw first;
  return result;
}
