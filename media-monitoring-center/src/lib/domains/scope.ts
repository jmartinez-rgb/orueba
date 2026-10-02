import type { BudgetRow, Catalog } from "@/lib/types";
import type { BrandId } from "@/lib/brands";
import { domainMetadata, type GoogleDomainConfig } from "./config";
import type { DomainSelection } from "./types";

export const DOMAIN_COOKIE = "immc_domain";
export function parseDomainFilter(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "all";
}
export function selectDomain(value: unknown, brand: BrandId, config: GoogleDomainConfig | null): DomainSelection {
  const id = brand === "izzi" ? parseDomainFilter(value) : "all";
  const version = config?.version ?? null;
  if (id === "all") return { id, name: "Todos los dominios", available: true, configVersion: version };
  const domain = config?.domains.find(domain => domain.id === id);
  return { id, name: domain?.name ?? (id === "unclassified" ? "Sin clasificar" : "Dominio no disponible"), available: !!config && (id === "unclassified" || !!domain), configVersion: version };
}
export function enrichCatalog(catalog: Catalog, config: GoogleDomainConfig | null, brand: BrandId): Catalog {
  const accounts = catalog.accounts.map(account => ({ ...account, ...domainMetadata(config, account.platform, account.id, account.name, account.brand ?? brand) }));
  const accountById = new Map(accounts.map(account => [account.id, account]));
  return { accounts, campaigns: catalog.campaigns.map(campaign => ({ ...campaign, ...domainMetadata(config, campaign.platform, campaign.accountId, accountById.get(campaign.accountId)?.name ?? campaign.accountId, accountById.get(campaign.accountId)?.brand ?? brand) })) };
}
export function filterCatalog(catalog: Catalog, selection: DomainSelection): Catalog {
  if (selection.id === "all") return catalog;
  const accounts = selection.available ? catalog.accounts.filter(account => account.platform === "google" && account.domain_id === selection.id) : [];
  const ids = new Set(accounts.map(account => account.id));
  return { accounts, campaigns: catalog.campaigns.filter(campaign => ids.has(campaign.accountId)) };
}
/** No brand-wide total/platform budget can be silently assigned to a selected domain. */
export function scopedBudgets(rows: BudgetRow[], catalog: Catalog, selected: boolean): BudgetRow[] {
  if (!selected) return rows;
  const accounts = new Map(catalog.accounts.map(account => [account.id, account.platform]));
  const campaigns = new Map(catalog.campaigns.map(campaign => [campaign.id, campaign]));
  return rows.filter(row => row.level === "account" ? !!row.accountId && accounts.get(row.accountId) === row.platform : row.level === "campaign" ? !!row.campaignId && campaigns.get(row.campaignId)?.platform === row.platform && (!row.accountId || campaigns.get(row.campaignId)?.accountId === row.accountId) : false);
}
