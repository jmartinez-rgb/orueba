import type { NormalizedAccount, NormalizedCampaign, NormalizedPerformance } from "../types/normalized.js";

/**
 * Almacenamiento histórico (BigQuery en la fase del data warehouse). Escritura idempotente: la
 * llave de una fila es client_id + platform + account_id + campaign_id + date + hour.
 */
export interface PerformanceRepository {
  upsertPerformance(rows: NormalizedPerformance[]): Promise<{ written: number }>;
  upsertAccounts(rows: NormalizedAccount[]): Promise<{ written: number }>;
  upsertCampaigns(rows: NormalizedCampaign[]): Promise<{ written: number }>;
}

/** Llave idempotente de una fila de rendimiento. */
export function performanceKey(
  r: Pick<NormalizedPerformance, "client_id" | "platform" | "account_id" | "campaign_id" | "date" | "hour">,
): string {
  return [r.client_id ?? "", r.platform, r.account_id, r.campaign_id ?? "", r.date, r.hour ?? ""].join("|");
}
