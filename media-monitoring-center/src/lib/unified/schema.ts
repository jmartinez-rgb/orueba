import { z } from "zod";
import { PLATFORM_IDS } from "@/lib/types";
import { isValidTimeZone } from "@/lib/time/tz";

const id = z.string().regex(/^[\w-]{1,80}$/);
export const scopeSchema = z.object({ platform: z.enum(PLATFORM_IDS as [typeof PLATFORM_IDS[number], ...typeof PLATFORM_IDS[number][]]), accountId: id, brand: z.enum(["izzi", "sky"]), currency: z.enum(["MXN", "USD"]) });
export const mappingSchema = z.object({ version: z.literal(1), accounts: z.array(scopeSchema).min(1).max(100) }).superRefine((v, ctx) => {
  const keys = v.accounts.map(a => `${a.platform}/${a.accountId}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Una cuenta solo puede tener una marca explícita." });
});
export type UnifiedMapping = z.infer<typeof mappingSchema>;
export type UnifiedScope = z.infer<typeof scopeSchema>;
export const sameScope = (a: UnifiedScope, b: UnifiedScope) => a.platform === b.platform && a.accountId === b.accountId && a.brand === b.brand && a.currency === b.currency;
const time = z.iso.datetime({ offset: true });
const number = z.number().finite().nonnegative().nullable();
const domainFields = { domain_id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).nullable().optional(), domain_name: z.string().max(120).nullable().optional(), customer_id: z.string().regex(/^\d{10}$/).nullable().optional(), account_name: z.string().max(240).nullable().optional(), domain_config_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() };
export const accountSchema = z.object({ ...domainFields, platform: scopeSchema.shape.platform, account_id: id, account_name: z.string(), currency: z.enum(["MXN", "USD"]), timezone: z.string().min(1).max(80).nullable(), is_manager: z.boolean().optional() });
export const campaignSchema = z.object({ ...domainFields, platform: scopeSchema.shape.platform, account_id: id, campaign_id: id, campaign_name: z.string(), campaign_status: z.enum(["active", "paused", "removed", "unknown"]), source_status: z.string().nullable(), objective: z.string().nullable() });
export const performanceSchema = z.object({ ...domainFields, platform: scopeSchema.shape.platform, account_id: id, campaign_id: id, date: z.iso.date(), hour: z.number().int().min(0).max(23).nullable(), currency: z.enum(["MXN", "USD"]), source_timezone: z.string().refine(isValidTimeZone), spend: number, impressions: number, clicks: number, extracted_at: time, raw_metrics: z.object({ report_utc_offset_minutes: z.number().int().min(-840).max(840).optional() }).default({}) });
export type ApiPerformance = z.infer<typeof performanceSchema>;
export const attemptSchema = z.object({ at: time, status: z.enum(["SUCCESS", "FAILED"]), code: z.string().regex(/^[A-Z_]{1,80}$/).nullable(), rows: z.number().int().nonnegative() });
export const catalogSchema = z.object({ version: z.literal(1), scope: scopeSchema, extractedAt: time, account: accountSchema, campaigns: z.array(campaignSchema) });
export const partitionSchema = z.object({ version: z.literal(1), scope: scopeSchema, date: z.iso.date(), granularity: z.enum(["daily", "hourly"]), extractedAt: time, rows: z.array(performanceSchema) });
export type ApiCatalog = z.infer<typeof catalogSchema>;
export type ApiPartition = z.infer<typeof partitionSchema>;
export type SyncAttempt = z.infer<typeof attemptSchema>;
export const sourceId = (s: UnifiedScope) => `${s.platform}:${s.accountId}`;
export const campaignId = (s: UnifiedScope, id: string) => `${sourceId(s)}:${id}`;

export class UnifiedDataError extends Error {
  constructor(readonly code: string) { super(`No se pudo cargar la fuente de APIs directas (${code}).`); this.name = "UnifiedDataError"; }
}
