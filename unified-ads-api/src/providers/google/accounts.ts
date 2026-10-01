import type { NormalizedAccount } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { customerId } from "./config.js";
import type { GoogleAdsClient } from "./client.js";
import type { GoogleCustomer } from "./types.js";
import { CLIENTS_QUERY, CUSTOMER_QUERY } from "./queries.js";
import { unavailableAccountWarning } from "./errors.js";

export function normalizeAccount(c: GoogleCustomer, client: GoogleAdsClient, login?: string): NormalizedAccount {
  if (!c.id) throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una cuenta sin identificador.");
  const id = customerId(c.id);
  return {
    platform: "google",
    client_id: client.config.clientMapping[id] ?? null,
    account_id: id,
    account_name: c.descriptiveName ?? id,
    currency: c.currencyCode ?? null,
    timezone: c.timeZone ?? null,
    status: c.status ?? null,
    manager_account_id: login ?? null,
    is_manager: c.manager ?? false,
  };
}

export async function readAccount(
  client: GoogleAdsClient,
  id: string,
  signal: AbortSignal,
  login = client.config.loginCustomerId,
): Promise<NormalizedAccount> {
  const rows = await client.search(id, CUSTOMER_QUERY, signal, login);
  const c = rows[0]?.customer;
  if (!c) throw new ApiError("ACCESS_DENIED", "Google Ads no devolvió la cuenta solicitada.");
  const account = normalizeAccount(c, client, login);
  if (account.account_id !== customerId(id))
    throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una cuenta diferente de la solicitada.");
  return account;
}

export async function discoverAccounts(
  client: GoogleAdsClient,
  signal: AbortSignal,
  onWarning?: (error: ApiError) => void,
): Promise<NormalizedAccount[]> {
  const roots = client.config.customerIds.length
    ? client.config.customerIds
    : client.config.loginCustomerId
      ? [client.config.loginCustomerId]
      : await client.accessibleCustomers(signal);
  const found = new Map<string, NormalizedAccount>();
  let firstUnavailable: ApiError | null = null;
  // Paralelismo limitado: una identidad puede tener muchas raíces accesibles.
  for (let offset = 0; offset < roots.length; offset += 4) {
    const batch = await Promise.all(
      roots
        .slice(offset, offset + 4)
        .filter((id) => !found.has(id))
        .map(async (id) => {
          let root: NormalizedAccount;
          try {
            root = await readAccount(client, id, signal);
          } catch (error) {
            const warning = unavailableAccountWarning(error, id);
            if (!warning) throw error;
            firstUnavailable ??= warning;
            onWarning?.(warning);
            return [];
          }
          const accounts = [root];
          if (root.is_manager) {
            const login = client.config.loginCustomerId ?? root.account_id;
            for (const row of await client.search(id, CLIENTS_QUERY, signal, login)) {
              if (!row.customerClient)
                throw new ApiError("PROVIDER_ERROR", "Google Ads devolvió una cuenta de MCC inválida.");
              accounts.push(normalizeAccount(row.customerClient, client, login));
            }
          }
          return accounts;
        }),
    );
    for (const accounts of batch) {
      accounts.forEach((account, i) => {
        if (i === 0 || !found.has(account.account_id)) found.set(account.account_id, account);
      });
    }
  }
  if (!found.size && firstUnavailable) throw firstUnavailable;
  return [...found.values()];
}
