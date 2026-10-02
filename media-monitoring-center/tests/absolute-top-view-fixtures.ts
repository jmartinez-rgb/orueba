import type { AbsoluteTopDashboard, AbsoluteTopEvaluation } from "@/lib/absolute-top/types";

export function absoluteTopViewRow(patch: Partial<AbsoluteTopEvaluation> = {}): AbsoluteTopEvaluation {
  return {
    entity_key: "1234567890:campaign:456", audit_id: "audit-1", audit_at: "2026-10-02T15:00:00Z", coverage: "complete",
    level: "campaign", domain_id: "custom_domain", domain_name: "Dominio de prueba", customer_id: "1234567890", account_id: "1234567890", account_name: "Cuenta de prueba",
    campaign_id: "456", campaign_name: "Search | Paquetes", campaign_status: "active", ad_group_id: null, ad_group_name: null, ad_group_status: null,
    date: "2026-10-01", hour: null, currency: "MXN", source_timezone: "America/Mexico_City", extracted_at: "2026-10-02T14:58:00Z",
    absolute_top_rate: 0.73, top_of_page_rate: 0.90, search_impression_share: 0.47, search_lost_is_rank: 0.25, search_lost_is_budget: 0.20,
    impressions: 10_000, clicks: 100, ctr: 1, cpc: 12, spend: 1200, conversions: 7, bidding_strategy: "TARGET_CPA", daily_budget: 5000,
    share_bounds: {}, warnings: [], target_rate: 0.70, gap_pp: 3, state: "meets", severity: "NORMAL", severity_score: 0, score_components: {}, group_weight: null, sudden_drop: false,
    persistence: { consecutive_audits: 0, label: "Dentro del objetivo", first_detected_at: null, last_detected_at: null, hours_since_detection: null, worst_rate: 0.73, best_rate: 0.73, mean_rate: 0.73, audit_id: "audit-1" },
    comparison: { previous: { rate: null, delta_pp: null, samples: 0, approximate: false }, previous_day: { rate: null, delta_pp: null, samples: 0, approximate: false }, last_24h: { rate: null, delta_pp: null, samples: 0, approximate: true }, last_7d: { rate: null, delta_pp: null, samples: 0, approximate: true } },
    evolution: [{ at: "2026-10-02T15:00:00Z", rate: 0.73, impressions: 10_000, audit_id: "audit-1" }], cross_status: "localized", diagnostics: ["La campaña cumple, pero un grupo de anuncios está fuera del objetivo."], ...patch,
  };
}

export function absoluteTopViewSnapshot(): AbsoluteTopDashboard {
  const campaign = absoluteTopViewRow();
  const group = absoluteTopViewRow({ entity_key: "1234567890:ad_group:456:789", level: "ad_group", ad_group_id: "789", ad_group_name: "Internet 350 MB", ad_group_status: "active", absolute_top_rate: 0.45, gap_pp: -25, state: "below", severity: "CRITICAL", severity_score: 90, impressions: 8_000, group_weight: 0.80 });
  return {
    brand: "izzi", selectedDomain: "all", configured: true, available: true, lastAuditAt: "2026-10-02T15:00:00Z",
    domains: [{ id: "custom_domain", name: "Dominio de prueba", accounts: [{ customerId: "1234567890", name: "Cuenta de prueba" }], absoluteTopMinimum: 0.70 }],
    policy: { minImpressions: 100, warningGapPp: 5, suddenDropThresholdPp: 7, deepeningGapPp: 3, repeatAfterHours: 12, retentionDays: 90 },
    rows: [campaign, group], summaries: [{ domain_id: "custom_domain", domain_name: "Dominio de prueba", target_rate: 0.70, campaigns: 1, ad_groups: 1, meets: 1, near: 0, below: 1, insufficient: 0, compliance_rate: 0.5, weighted_absolute_top: 0.73, weighting_approximate: true, severity_score: 90 }],
    warnings: [], approximationNotice: "Ponderado por impresiones de campañas: indicador aproximado, no se duplican grupos.",
  };
}
