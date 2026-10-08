import { PLATFORM_IDS } from "@/lib/types";
import { UnifiedDataError, type UnifiedMapping, type UnifiedScope } from "./schema";

export type UnifiedSelection = { provider?: typeof PLATFORM_IDS[number]; brand?: UnifiedScope["brand"] };
export type SyncCliOptions = UnifiedSelection & { from?: string; to?: string; granularity: "daily" | "hourly" | "both" };
export type RefreshCliOptions = UnifiedSelection & { watch: boolean; intervalMinutes: number; historyDays: number };

function selection(values: Record<string, string>, code: "INVALID_OPTIONS" | "INVALID_REFRESH_OPTIONS"): UnifiedSelection {
  const provider = values["--provider"], brand = values["--brand"];
  if ((provider !== undefined && !PLATFORM_IDS.includes(provider as typeof PLATFORM_IDS[number])) || (brand !== undefined && brand !== "izzi" && brand !== "sky")) throw new UnifiedDataError(code);
  return { ...(provider ? { provider: provider as typeof PLATFORM_IDS[number] } : {}), ...(brand ? { brand: brand as UnifiedScope["brand"] } : {}) };
}

/** Validate all flags before environment loading or any account/API operation. */
export function parseSyncOptions(args: readonly string[]): SyncCliOptions {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!["--from", "--to", "--granularity", "--provider", "--brand"].includes(flag) || !value || value.startsWith("--") || Object.hasOwn(values, flag)) throw new UnifiedDataError("INVALID_OPTIONS");
    values[flag] = value;
  }
  const granularity = values["--granularity"] ?? "both";
  if (granularity !== "daily" && granularity !== "hourly" && granularity !== "both") throw new UnifiedDataError("INVALID_OPTIONS");
  return { ...selection(values, "INVALID_OPTIONS"), ...(values["--from"] ? { from: values["--from"] } : {}), ...(values["--to"] ? { to: values["--to"] } : {}), granularity };
}

export function parseRefreshOptions(args: readonly string[]): RefreshCliOptions {
  const values: Record<string, string> = {};
  let watch = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
    seen.add(flag);
    if (flag === "--watch") { watch = true; continue; }
    const value = args[++i];
    if (!["--provider", "--brand", "--interval-minutes", "--history-days"].includes(flag) || !value || value.startsWith("--")) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
    values[flag] = value;
  }
  const rawInterval = values["--interval-minutes"] ?? "120";
  const intervalMinutes = Number(rawInterval);
  if (!/^\d+$/.test(rawInterval) || !Number.isInteger(intervalMinutes) || intervalMinutes < 30 || intervalMinutes > 1440) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
  // Older days the round completes once when they are missing (0 turns it off); 35 covers the comparison.
  const rawHistory = values["--history-days"] ?? "35";
  const historyDays = Number(rawHistory);
  if (!/^\d+$/.test(rawHistory) || (historyDays !== 0 && (historyDays < 7 || historyDays > 44))) throw new UnifiedDataError("INVALID_REFRESH_OPTIONS");
  return { ...selection(values, "INVALID_REFRESH_OPTIONS"), watch, intervalMinutes, historyDays };
}

/** Exact brand membership from the explicit mapping; never names or a fallback to other brands. */
export function filterUnifiedMapping(mapping: UnifiedMapping, filters: UnifiedSelection): UnifiedMapping {
  // Keep the exported filter safe even when a JS caller bypasses the typed parsers.
  selection({ ...(filters.provider !== undefined ? { "--provider": filters.provider } : {}), ...(filters.brand !== undefined ? { "--brand": filters.brand } : {}) }, "INVALID_OPTIONS");
  const accounts = mapping.accounts.filter(account => (!filters.provider || account.platform === filters.provider) && (!filters.brand || account.brand === filters.brand));
  if (!accounts.length) throw new UnifiedDataError("NO_MAPPED_ACCOUNTS");
  return { ...mapping, accounts };
}
