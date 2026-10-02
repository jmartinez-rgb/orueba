import { z } from "zod";
import type { DomainMetadata, PlatformId } from "@/lib/types";

const domainId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).refine(id => !["all", "unclassified"].includes(id));
const account = z.object({ customerId: z.string().regex(/^\d{10}$/), name: z.string().min(1).max(240) }).strict();
/** The API owns the only account/target map. The monitor validates and caches that contract. */
export const googleDomainsSchema = z.object({
  version: z.literal(1),
  domains: z.array(z.object({ id: domainId, name: z.string().min(1).max(120), accounts: z.array(account).min(1).max(100), absoluteTopMinimum: z.number().finite().min(0).max(1) }).strict()).min(1).max(30),
  absoluteTop: z.object({ minImpressions: z.number().int().min(1).max(1e9), warningGapPp: z.number().finite().min(0).max(100), suddenDropThresholdPp: z.number().finite().min(0).max(100), deepeningGapPp: z.number().finite().min(0).max(100), repeatAfterHours: z.number().finite().positive().max(8760), retentionDays: z.number().int().min(7).max(3650) }).strict(),
}).strict().superRefine((config, ctx) => {
  if (new Set(config.domains.map(domain => domain.id)).size !== config.domains.length) ctx.addIssue({ code: "custom", message: "Dominio duplicado." });
  const ids = config.domains.flatMap(domain => domain.accounts.map(account => account.customerId));
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Una cuenta no puede pertenecer a dos dominios." });
});
export type GoogleDomainConfig = z.infer<typeof googleDomainsSchema>;

export function normalizeGoogleCustomerId(value: string): string | null {
  const id = value.startsWith("google:") ? value.slice(7) : value;
  return /^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(id) ? id.replaceAll("-", "") : null;
}

export function domainMetadata(config: GoogleDomainConfig | null, platform: PlatformId, accountId: string, accountName: string, brand?: string): DomainMetadata {
  const customer = platform === "google" ? normalizeGoogleCustomerId(accountId) : null;
  const base = { customer_id: customer, account_name: accountName, domain_id: null, domain_name: null };
  if (platform !== "google" || brand === "sky" || !customer || !config) return base;
  const domain = config.domains.find(domain => domain.accounts.some(account => account.customerId === customer));
  return { ...base, domain_id: domain?.id ?? "unclassified", domain_name: domain?.name ?? "Sin clasificar" };
}
