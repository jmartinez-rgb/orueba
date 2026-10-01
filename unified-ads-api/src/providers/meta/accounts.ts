import type { NormalizedAccount } from "../../types/normalized.js";
import type { MetaClient } from "./client.js";
import { metaAccountId } from "./config.js";
import { accountFields } from "./queries.js";
import { normalizeAccount } from "./normalize.js";
import type { MetaAccount } from "./types.js";
import { metaAccountWarning } from "./errors.js";
import { ApiError } from "../../utils/errors.js";

export async function readMetaAccount(client: MetaClient, id: string, signal: AbortSignal): Promise<NormalizedAccount> {
  const account = await client.get<MetaAccount>(
    `act_${metaAccountId(id)}`,
    { fields: accountFields(client.config) },
    signal,
  );
  const normalized = normalizeAccount(account, client.config);
  if (normalized.account_id !== metaAccountId(id)) throw new ApiError("PROVIDER_ERROR", "Meta devolvió otra cuenta.");
  return normalized;
}
export async function discoverMetaAccounts(
  client: MetaClient,
  signal: AbortSignal,
  onWarning: (error: ApiError) => void,
): Promise<NormalizedAccount[]> {
  const result = new Map<string, NormalizedAccount>();
  let success = 0;
  let firstError: ApiError | null = null;
  if (client.config.accountIds.length) {
    for (const id of client.config.accountIds) {
      try {
        const account = await readMetaAccount(client, id, signal);
        result.set(account.account_id, account);
        success++;
      } catch (err) {
        const warning = metaAccountWarning(err, id);
        if (!warning) throw err;
        firstError ??= warning;
        onWarning(warning);
      }
    }
  } else {
    const paths = client.config.businessIds.length
      ? client.config.businessIds.flatMap((id) => [`${id}/owned_ad_accounts`, `${id}/client_ad_accounts`])
      : ["me/adaccounts"];
    for (const path of paths) {
      // Un fallo de business discovery es global: no se oculta como cuenta individual.
      const rows = await client.list<MetaAccount>(path, { fields: accountFields(client.config) }, signal);
      for (const row of rows) {
        const account = normalizeAccount(row, client.config);
        // owned_ad_accounts demuestra propiedad; client_ad_accounts no identifica al propietario.
        account.manager_account_id ??= path.endsWith("/owned_ad_accounts") ? path.split("/")[0]! : null;
        account.manager_account_id ??= result.get(account.account_id)?.manager_account_id ?? null;
        result.set(account.account_id, account);
      }
      success++;
    }
  }
  if (!success && firstError) throw firstError;
  return [...result.values()];
}
