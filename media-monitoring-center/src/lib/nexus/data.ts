import type { Snapshot } from "@/lib/services/snapshot";
import type { EntityEvaluation } from "@/lib/monitoring/types";
import type { NexusData, NexusMetrics } from "./types";

export function readableName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, 160);
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function values(entity: EntityEvaluation | undefined): NexusMetrics {
  if (!entity || entity.dataState === "NO_DATA") return { spend: null, impressions: null, clicks: null };
  return {
    spend: finite(entity?.cumulative.spend?.current),
    impressions: finite(entity?.cumulative.impressions?.current),
    clicks: finite(entity?.cumulative.clicks?.current),
  };
}

export function projectNexusData(snapshot: Snapshot): NexusData {
  const brand = snapshot.meta.brand.id;
  const domain = snapshot.meta.domain;
  // The catalog is already brand-scoped by getSnapshot; explicit assignments are checked again.
  const accounts = snapshot.catalog.accounts.filter(account => (!account.brand || account.brand === brand) && (!domain || domain.id === "all" || domain.available && account.platform === "google" && account.domain_id === domain.id));
  const accountKeys = new Set(accounts.map(account => `${account.platform}:${account.id}`));
  const campaigns = snapshot.catalog.campaigns.filter(campaign => accountKeys.has(`${campaign.platform}:${campaign.accountId}`));
  const campaignKeys = new Set(campaigns.map(campaign => `${campaign.platform}:${campaign.accountId}:${campaign.id}`));
  const platforms = new Set(accounts.map(account => account.platform));
  const inScope = (row: { platform: string; accountId: string | null; campaignId: string | null }) => {
    if (row.campaignId) return !!row.accountId && campaignKeys.has(`${row.platform}:${row.accountId}:${row.campaignId}`);
    // A brand-wide platform incident is not evidence of an incident in a particular domain.
    return row.accountId ? accountKeys.has(`${row.platform}:${row.accountId}`) : (!domain || domain.id === "all") && [...platforms].includes(row.platform as typeof accounts[number]["platform"]);
  };
  return {
    context: {
      brand, brandName: snapshot.meta.brand.name, date: snapshot.meta.businessDate,
      cutoffHour: snapshot.meta.cutoffHour, timezone: snapshot.meta.timezone, asOf: snapshot.meta.asOf, mode: snapshot.meta.mode,
      domain: domain ? { id: domain.id, name: readableName(domain.name), available: domain.available, configVersion: domain.configVersion } : undefined,
    },
    accounts: accounts.map(account => {
      const entity = snapshot.run.entities.find(row => row.level === "account" && row.platform === account.platform && row.accountId === account.id);
      return {
        id: account.id, accountId: account.id, name: readableName(account.name), platform: account.platform,
        status: "Cuenta del catálogo", dataState: entity?.dataState ?? "NO_DATA", lastDataAt: entity?.lastDataAt ?? null,
        cutoffHour: entity?.cutoffHour ?? null, metrics: values(entity),
        domain_id: account.domain_id, domain_name: account.domain_name ? readableName(account.domain_name) : account.domain_name,
      };
    }),
    campaigns: campaigns.map(campaign => {
      const entity = snapshot.run.entities.find(row => row.level === "campaign" && row.platform === campaign.platform && row.accountId === campaign.accountId && row.campaignId === campaign.id);
      return {
        id: campaign.id, name: readableName(campaign.name), platform: campaign.platform, accountId: campaign.accountId,
        status: campaign.status, dataState: entity?.dataState ?? "NO_DATA", lastDataAt: entity?.lastDataAt ?? null,
        cutoffHour: entity?.cutoffHour ?? null, metrics: values(entity),
        domain_id: campaign.domain_id, domain_name: campaign.domain_name ? readableName(campaign.domain_name) : campaign.domain_name,
      };
    }),
    platforms: [...platforms].map(id => ({ id, state: snapshot.platformStatus[id].dataState, lastDataAt: snapshot.run.dataHealth[id].lastDataAt })),
    alerts: snapshot.state.alerts.filter(row => row.resolvedAt === null && !row.groupedUnder && row.status !== "FALSE_POSITIVE" && inScope(row)).map(row => ({ id: row.id, platform: row.platform, severity: row.severity, status: row.status })),
    incidents: snapshot.state.incidents.filter(row => row.resolvedAt === null && inScope(row)).map(row => ({ id: row.id, platform: row.platform, severity: row.severity, status: row.status })),
    missingFx: snapshot.currency.issues.filter(issue => issue.kind === "missing" && accountKeys.has(`${issue.platform}:${issue.accountId}`)).length,
    fallbackFx: snapshot.currency.issues.filter(issue => issue.kind === "fallback" && accountKeys.has(`${issue.platform}:${issue.accountId}`)).length,
  };
}
