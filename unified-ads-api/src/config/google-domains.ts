import { z } from "zod";
import master from "./google-ads-domains.json" with { type: "json" };

const domain = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .refine((id) => id !== "all" && id !== "unclassified"),
  name: z.string().trim().min(1).max(100),
  accounts: z
    .array(z.object({ customerId: z.string().regex(/^\d{10}$/), name: z.string().min(1).max(200) }))
    .min(1)
    .max(100),
  absoluteTopMinimum: z.number().min(0).max(1),
});

/** One master definition, served to the monitor; consumers must never copy the account map. */
export const googleDomainConfigSchema = z
  .object({
    version: z.literal(1),
    domains: z.array(domain).min(1).max(25),
    absoluteTop: z.object({
      minImpressions: z.number().int().min(1).max(1000000),
      warningGapPp: z.number().min(0).max(100),
      suddenDropThresholdPp: z.number().positive().max(100),
      deepeningGapPp: z.number().positive().max(100),
      repeatAfterHours: z.number().positive().max(720),
      retentionDays: z.number().int().min(7).max(365),
    }),
  })
  .superRefine((config, ctx) => {
    const ids = config.domains.map((d) => d.id);
    const customers = config.domains.flatMap((d) => d.accounts.map((a) => a.customerId));
    if (new Set(ids).size !== ids.length || new Set(customers).size !== customers.length)
      ctx.addIssue({ code: "custom", message: "Los dominios y Customer IDs deben ser únicos." });
  });

export type GoogleDomainConfig = z.infer<typeof googleDomainConfigSchema>;
export type DomainMetadata = {
  domain_id: string;
  domain_name: string;
  customer_id: string;
  account_name: string | null;
  absolute_top_minimum: number | null;
  domain_warning: "GOOGLE_DOMAIN_UNCLASSIFIED" | null;
};

export const GOOGLE_ADS_DOMAIN_CONFIG: GoogleDomainConfig = googleDomainConfigSchema.parse(master);

/** Only canonical 10-digit IDs or Google's exact XXX-XXX-XXXX representation are accepted. */
export function normalizeGoogleCustomerId(value: string): string | null {
  const trimmed = value.trim();
  if (!/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(trimmed)) return null;
  return trimmed.replaceAll("-", "");
}

export function googleDomainMetadata(customerId: string, accountName: string | null = null): DomainMetadata {
  const canonical = normalizeGoogleCustomerId(customerId);
  const selected =
    canonical && GOOGLE_ADS_DOMAIN_CONFIG.domains.find((d) => d.accounts.some((a) => a.customerId === canonical));
  const configured = selected ? selected.accounts.find((a) => a.customerId === canonical) : null;
  return {
    domain_id: selected ? selected.id : "unclassified",
    domain_name: selected ? selected.name : "Unclassified",
    customer_id: canonical ?? customerId,
    account_name: accountName ?? configured?.name ?? null,
    absolute_top_minimum: selected ? selected.absoluteTopMinimum : null,
    domain_warning: selected ? null : "GOOGLE_DOMAIN_UNCLASSIFIED",
  };
}

export function withGoogleDomain<T extends { account_id: string; account_name?: string | null }>(
  value: T,
): T & DomainMetadata {
  return { ...value, ...googleDomainMetadata(value.account_id, value.account_name ?? null) };
}
