import type { BrandId } from "@/lib/brands";
import type { MonitoringRun } from "@/lib/monitoring/types";
import type { PlatformId } from "@/lib/types";
import { domainMetadata, type GoogleDomainConfig } from "./config";

/** Attribute entity observations before reconciliation, so stored generic incidents carry the same master dimension. */
export function annotateDomainRun(run: MonitoringRun, config: GoogleDomainConfig | null, brand: BrandId): MonitoringRun {
  const annotate = <T extends { platform: PlatformId; accountId: string | null; accountName: string | null }>(entity: T): T => ({
    ...entity,
    ...(entity.accountId
      ? domainMetadata(config, entity.platform, entity.accountId, entity.accountName ?? entity.accountId, brand)
      : { domain_id: null, domain_name: null, customer_id: null, account_name: null }),
  });
  return { ...run, entities: run.entities.map(annotate), anomalies: run.anomalies.map(annotate) };
}
