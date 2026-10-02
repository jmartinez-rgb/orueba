import { z } from "zod";
import { isValidTimeZone } from "@/lib/time/tz";

const value = z.number().finite().nonnegative().nullable();
const rate = z.number().finite().min(0).max(1).nullable();
const id = z.string().regex(/^[\w-]{1,80}$/);
export const absoluteTopRowSchema = z.object({
  level: z.enum(["campaign", "ad_group"]),
  domain_id: z.string().max(80).nullable(), domain_name: z.string().max(200).nullable(),
  customer_id: z.string().regex(/^\d{10}$/), account_id: id, account_name: z.string().max(500),
  campaign_id: id, campaign_name: z.string().max(500), campaign_status: z.literal("active"),
  ad_group_id: id.nullable(), ad_group_name: z.string().max(500).nullable(), ad_group_status: z.literal("active").nullable(),
  date: z.iso.date(), hour: z.number().int().min(0).max(23).nullable(), currency: z.string().regex(/^[A-Z]{3}$/),
  source_timezone: z.string().refine(isValidTimeZone), extracted_at: z.iso.datetime({ offset: true }),
  absolute_top_rate: rate, top_of_page_rate: rate, search_impression_share: rate,
  search_lost_is_rank: rate, search_lost_is_budget: rate,
  impressions: value, clicks: value, ctr: z.number().finite().min(0).nullable(), cpc: value, spend: value, conversions: value,
  bidding_strategy: z.string().max(200).nullable(), daily_budget: value,
  share_bounds: z.object({ search_impression_share: z.enum(["lt_10_percent", "gt_90_percent"]).optional(), search_lost_is_rank: z.enum(["lt_10_percent", "gt_90_percent"]).optional(), search_lost_is_budget: z.enum(["lt_10_percent", "gt_90_percent"]).optional() }).default({}),
  warnings: z.array(z.string().max(300)).max(50),
}).superRefine((row, ctx) => {
  if ((row.level === "campaign" && (row.ad_group_name !== null || row.ad_group_status !== null)) || (row.level === "campaign") !== (row.ad_group_id === null) || (row.level === "ad_group" && (row.ad_group_name === null || row.ad_group_status === null))) ctx.addIssue({ code: "custom", message: "Invalid entity hierarchy." });
});

export const absoluteTopAuditSchema = z.object({
  version: z.literal(1), auditId: z.string().regex(/^[\w-]{1,100}$/), customerId: z.string().regex(/^\d{10}$/),
  observedAt: z.iso.datetime({ offset: true }), from: z.iso.date(), to: z.iso.date(), granularity: z.enum(["daily", "hourly"]),
  coverage: z.enum(["complete", "partial", "unavailable"]), rows: z.array(absoluteTopRowSchema).max(100000), warnings: z.array(z.string().max(300)).max(100),
}).superRefine((audit, ctx) => {
  const length = (Date.parse(audit.to) - Date.parse(audit.from)) / 86400000;
  if (length < 0 || length > 6) ctx.addIssue({ code: "custom", message: "An audit covers at most seven days." });
  const keys = new Set<string>();
  const zones = new Set<string>();
  for (const row of audit.rows) {
    const key = `${row.level}/${row.campaign_id}/${row.ad_group_id}/${row.date}/${row.hour}`;
    if (row.customer_id !== audit.customerId || row.date < audit.from || row.date > audit.to || (audit.granularity === "daily") !== (row.hour === null) || keys.has(key)) ctx.addIssue({ code: "custom", message: "Inconsistent or duplicate audit row." });
    keys.add(key); zones.add(row.source_timezone);
  }
  if (zones.size > 1) ctx.addIssue({ code: "custom", message: "A customer audit must have one source timezone." });
});
