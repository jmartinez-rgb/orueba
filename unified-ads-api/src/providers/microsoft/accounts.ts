import type { NormalizedAccount } from "../../types/normalized.js";
import { ApiError } from "../../utils/errors.js";
import { microsoftId, object, type MicrosoftConfig } from "./config.js";
import type { MicrosoftClient } from "./client.js";
import { microsoftAccountWarning } from "./errors.js";

export function vendorId(value: unknown): string {
  try {
    return microsoftId(value);
  } catch {
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió un ID inválido o sin precisión suficiente.");
  }
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(object))
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una lista incompatible.");
  return value;
}
export function normalizeAccount(row: Record<string, unknown>, config: MicrosoftConfig): NormalizedAccount {
  const id = vendorId(row.Id);
  if (typeof row.Name !== "string" || !row.Name)
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una cuenta sin nombre.");
  return {
    platform: "microsoft",
    client_id: config.clientMapping[id] ?? null,
    account_id: id,
    account_name: row.Name,
    currency: typeof row.CurrencyCode === "string" ? row.CurrencyCode : null,
    // Preserve the official TimeZoneType identifier. Reporting rows themselves are UTC.
    timezone: typeof row.TimeZone === "string" ? row.TimeZone : null,
    status: typeof row.AccountLifeCycleStatus === "string" ? row.AccountLifeCycleStatus : null,
    manager_account_id: row.ParentCustomerId == null ? null : vendorId(row.ParentCustomerId),
  };
}
export async function readMicrosoftUser(client: MicrosoftClient, signal: AbortSignal): Promise<string> {
  const body = await client.call("user", { UserId: null }, signal);
  if (!object(body.User)) throw new ApiError("PROVIDER_ERROR", "Microsoft no devolvió el usuario autenticado.");
  // Personal data and user-role arrays are never exposed by the unified API.
  return vendorId(body.User.Id);
}
export async function readMicrosoftAccount(client: MicrosoftClient, id: string, signal: AbortSignal) {
  const data = await client.call("account", { AccountId: microsoftId(id) }, signal);
  if (!object(data.Account)) throw new ApiError("PROVIDER_ERROR", "Microsoft no devolvió la cuenta solicitada.");
  const account = normalizeAccount(data.Account, client.config);
  if (account.account_id !== id) throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió otra cuenta.");
  return account;
}
export async function discoverMicrosoftAccounts(
  client: MicrosoftClient,
  signal: AbortSignal,
  onWarning: (e: ApiError) => void,
) {
  const result: NormalizedAccount[] = [];
  if (client.config.accountIds.length) {
    let first: ApiError | null = null;
    for (const id of client.config.accountIds) {
      try {
        result.push(await readMicrosoftAccount(client, id, signal));
      } catch (err) {
        const warning = microsoftAccountWarning(err, id);
        if (!warning) throw err;
        first ??= warning;
        onWarning(warning);
      }
    }
    if (!result.length && first) throw first;
    return result;
  }
  const userId = await readMicrosoftUser(client, signal),
    seen = new Set<string>();
  for (let index = 0; index < 1000; index++) {
    const body = await client.call(
      "accounts",
      {
        Predicates: [{ Field: "UserId", Operator: "Equals", Value: userId }],
        Ordering: [{ Field: "Id", Order: "Ascending" }],
        PageInfo: { Index: index, Size: 1000 },
      },
      signal,
    );
    const page = rows(body.Accounts);
    if (page.length > 1000) throw new ApiError("PROVIDER_ERROR", "Microsoft excedió el tamaño de página solicitado.");
    for (const row of page) {
      const account = normalizeAccount(row, client.config);
      if (seen.has(account.account_id))
        throw new ApiError("PROVIDER_ERROR", "Microsoft repitió una cuenta durante la paginación.");
      seen.add(account.account_id);
      result.push(account);
    }
    if (page.length < 1000) return result;
  }
  throw new ApiError("PROVIDER_ERROR", "Microsoft superó el límite seguro de paginación.");
}
