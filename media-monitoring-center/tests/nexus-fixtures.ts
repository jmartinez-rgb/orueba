import type { Snapshot } from "@/lib/services/snapshot";

export function nexusSnapshot(): Snapshot {
  const metrics = (spend: number | null, clicks: number | null, impressions: number | null) => ({ spend: { current: spend }, clicks: { current: clicks }, impressions: { current: impressions }, conversions: { current: 999 } });
  return {
    meta: { brand: { id: "izzi", name: "izzi" }, businessDate: "2026-10-02", cutoffHour: 12, timezone: "America/Mexico_City", asOf: "2026-10-02T18:00:00.000Z", mode: "unified", userName: "PRIVATE CONTACT" },
    catalog: {
      accounts: [
        { id: "acc1", name: "izzi Ofertas", platform: "google", brand: "izzi", currency: "MXN" },
        { id: "acc2", name: "izzi USD", platform: "google", brand: "izzi", currency: "USD" },
        { id: "sky-secret", name: "Sky foreign", platform: "meta", brand: "sky", currency: "MXN" },
      ],
      campaigns: [
        { id: "12345", name: "Promociones Fibra", platform: "google", accountId: "acc1", status: "ACTIVE" },
        { id: "54321", name: "Promociones Televisión", platform: "google", accountId: "acc1", status: "PAUSED" },
        { id: "sky-campaign", name: "Foreign private campaign", platform: "meta", accountId: "sky-secret", status: "ACTIVE" },
      ],
    },
    run: {
      entities: [
        { level: "account", platform: "google", accountId: "acc1", dataState: "OK", lastDataAt: "2026-10-02T17:00:00.000Z", cutoffHour: 12, cumulative: metrics(100, 20, 2_000) },
        { level: "account", platform: "google", accountId: "acc2", dataState: "DELAYED", lastDataAt: null, cutoffHour: 12, cumulative: metrics(null, null, null) },
        { level: "campaign", platform: "google", accountId: "acc1", campaignId: "12345", dataState: "OK", lastDataAt: "2026-10-02T17:00:00.000Z", cutoffHour: 12, cumulative: metrics(80, 20, 1_000) },
        { level: "campaign", platform: "google", accountId: "acc1", campaignId: "54321", dataState: "NO_DATA", lastDataAt: null, cutoffHour: 12, cumulative: metrics(null, null, null) },
        { level: "campaign", platform: "meta", accountId: "sky-secret", campaignId: "sky-campaign", dataState: "OK", cumulative: metrics(99_999, 800, 100_000) },
      ],
      dataHealth: { google: { lastDataAt: "2026-10-02T17:00:00.000Z" }, meta: { lastDataAt: "2026-10-02T17:00:00.000Z" } },
    },
    platformStatus: { google: { dataState: "PARTIAL" }, meta: { dataState: "OK" } },
    state: {
      alerts: [
        { id: "ALERT-1", platform: "google", accountId: "acc1", campaignId: "12345", severity: "CRITICAL", resolvedAt: null, groupedUnder: null, status: "NEW", diagnosis: "PRIVATE NOTE", title: "PRIVATE CONTACT" },
        { id: "FOREIGN-ALERT", platform: "meta", accountId: "sky-secret", campaignId: "sky-campaign", resolvedAt: null, groupedUnder: null, status: "NEW" },
      ],
      incidents: [
        { id: "INC-1", platform: "google", accountId: "acc1", campaignId: "12345", severity: "CRITICAL", resolvedAt: null, status: "OPEN", owner: "PRIVATE CONTACT", notes: [{ text: "PRIVATE NOTE" }] },
        { id: "FOREIGN-INC", platform: "meta", accountId: "sky-secret", campaignId: "sky-campaign", resolvedAt: null, status: "OPEN" },
      ], notifications: [{ text: "PRIVATE TOKEN", recipients: ["PRIVATE PHONE"] }],
    },
    currency: { rates: [], issues: [{ platform: "google", accountId: "acc2", kind: "missing" }, { platform: "meta", accountId: "sky-secret", kind: "missing" }] },
    settings: { recipients: ["PRIVATE PHONE"], integrations: { clientSecret: "PRIVATE TOKEN" } },
  } as unknown as Snapshot;
}
