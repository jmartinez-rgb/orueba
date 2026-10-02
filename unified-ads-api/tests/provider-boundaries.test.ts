import { describe, expect, it } from "vitest";
import type { NormalizedAccount, NormalizedPerformance, PerformanceQuery } from "../src/types/normalized.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import { MetaProvider } from "../src/providers/meta/index.js";
import { TikTokProvider } from "../src/providers/tiktok/index.js";
import { MicrosoftProvider } from "../src/providers/microsoft/index.js";
import { SpotifyProvider } from "../src/providers/spotify/index.js";
import { XProvider } from "../src/providers/x/index.js";
import {
  normalizePerformance as googlePerformance,
  normalizeConversion as googleConversion,
} from "../src/providers/google/normalize.js";
import {
  normalizePerformance as metaPerformance,
  normalizeConversions as metaConversions,
} from "../src/providers/meta/normalize.js";
import { normalizePerformance as tiktokPerformance } from "../src/providers/tiktok/normalize.js";
import { normalizePerformance as microsoftPerformance } from "../src/providers/microsoft/normalize.js";
import { normalizePerformance as spotifyPerformance } from "../src/providers/spotify/normalize.js";
import { normalizePerformance as xPerformance } from "../src/providers/x/normalize.js";
import { readGoogleConfig } from "../src/providers/google/config.js";
import { readMetaConfig } from "../src/providers/meta/config.js";
import { readTikTokConfig } from "../src/providers/tiktok/config.js";
import { readSpotifyConfig } from "../src/providers/spotify/config.js";
import { readXConfig } from "../src/providers/x/config.js";
import { insightsWindows } from "../src/providers/meta/queries.js";
import { reportWindows as tiktokWindows } from "../src/providers/tiktok/queries.js";
import { reportRanges as spotifyWindows } from "../src/providers/spotify/queries.js";
import { reportWindows as xWindows } from "../src/providers/x/reports.js";
import { GOOGLE_ENV } from "./google-simulator.js";
import { MetaSimulator } from "./meta-simulator.js";
import { TikTokSimulator } from "./tiktok-simulator.js";
import { SpotifySimulator, CAMPAIGN as SPOTIFY_CAMPAIGN } from "./spotify-simulator.js";
import { XSimulator, CAMPAIGN as X_CAMPAIGN } from "./x-simulator.js";
import { MICROSOFT_ENV } from "./microsoft-simulator.js";

const AT = "2026-09-30T12:00:00.000Z";
const DAY = 86400000;
const meta = new MetaSimulator();
const tiktok = new TikTokSimulator();
const spotify = new SpotifySimulator();
const x = new XSimulator();
const configs = {
  google: readGoogleConfig(GOOGLE_ENV).config!,
  meta: readMetaConfig(meta.env).config!,
  tiktok: readTikTokConfig(tiktok.env).config!,
  spotify: readSpotifyConfig({ ...spotify.env, SPOTIFY_ADS_PRIMARY_CONVERSION_METRIC: "PURCHASES" }).config!,
  x: readXConfig({ ...x.env, X_ADS_PRIMARY_CONVERSION_METRIC: "conversion_purchases" }).config!,
};
const query: PerformanceQuery = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" };

function account(platform: NormalizedAccount["platform"], id: string, currency = "MXN"): NormalizedAccount {
  return {
    platform,
    account_id: id,
    account_name: "Fixture account",
    currency,
    timezone: "America/Mexico_City",
    client_id: null,
    status: null,
    manager_account_id: null,
  };
}

describe("upstream calendar boundaries are not normalized into another month", () => {
  const badDates = ["2023-02-29", "2024-02-30", "2026-02-29", "2026-04-31", "2026-09-31", "2026-11-31"];
  it.each(["performance", "conversions"] as const)("Google rejects impossible upstream dates for %s", (kind) => {
    for (const date of badDates) {
      const range = { ...query, date_from: `${date.slice(0, 4)}-01-01`, date_to: `${date.slice(0, 4)}-12-31` };
      const row = {
        campaign: { id: "123" },
        segments: { date, conversionAction: "customers/2222222222/conversionActions/456" },
        metrics: {},
      };
      expect(
        () =>
          kind === "performance"
            ? googlePerformance(row, account("google", "2222222222"), range, AT)
            : googleConversion(row, account("google", "2222222222"), range, configs.google, AT),
        date,
      ).toThrow(expect.objectContaining({ code: "PROVIDER_ERROR" }));
    }
  });
  it.each(["performance", "conversions"] as const)("Meta rejects impossible upstream dates for %s", (kind) => {
    for (const date of badDates) {
      const range = { ...query, date_from: `${date.slice(0, 4)}-01-01`, date_to: `${date.slice(0, 4)}-12-31` };
      const row = { ...meta.insight, date_start: date, date_stop: date };
      expect(
        () =>
          kind === "performance"
            ? metaPerformance(row, account("meta", "111"), range, configs.meta, AT)
            : metaConversions(row, account("meta", "111"), range, configs.meta, AT),
        date,
      ).toThrow(expect.objectContaining({ code: "PROVIDER_ERROR" }));
    }
  });
});

type Sample = { spend: number; impressions: number; clicks: number; conversions: number };
type Normalizer = (sample: Sample, currency: string) => NormalizedPerformance;
const normalizers: Record<NormalizedAccount["platform"], Normalizer> = {
  google: (m, currency) =>
    googlePerformance(
      {
        campaign: { id: "123" },
        segments: { date: query.date_from },
        metrics: {
          costMicros: String(Math.round(m.spend * 1e6)),
          impressions: String(m.impressions),
          clicks: String(m.clicks),
          conversions: String(m.conversions),
        },
      },
      account("google", "2222222222", currency),
      query,
      AT,
    ),
  meta: (m, currency) =>
    metaPerformance(
      {
        ...meta.insight,
        account_currency: currency,
        spend: String(m.spend),
        impressions: String(m.impressions),
        clicks: String(m.clicks),
        actions: [{ action_type: configs.meta.primaryAction!, value: String(m.conversions) }],
      },
      account("meta", "111", currency),
      query,
      configs.meta,
      AT,
    ),
  tiktok: (m, currency) =>
    tiktokPerformance(
      {
        dimensions: tiktok.report.dimensions,
        metrics: {
          spend: String(m.spend),
          impressions: String(m.impressions),
          clicks: String(m.clicks),
          conversion: String(m.conversions),
        },
      },
      account("tiktok", tiktok.account.advertiser_id, currency),
      query,
      configs.tiktok,
      AT,
    ),
  microsoft: (m, currency) =>
    microsoftPerformance(
      {
        TimePeriod: query.date_from,
        AccountId: "101",
        CampaignId: "9007199254740993",
        CurrencyCode: currency,
        Spend: String(m.spend),
        Impressions: String(m.impressions),
        Clicks: String(m.clicks),
        ConversionsQualified: String(m.conversions),
      },
      account("microsoft", "101", currency),
      query,
      AT,
    ),
  spotify: (m, currency) =>
    spotifyPerformance(
      {
        entity_type: "CAMPAIGN",
        entity_id: SPOTIFY_CAMPAIGN,
        start_time: query.date_from + "T00:00:00Z",
        end_time: "2026-09-30T00:00:00Z",
        stats: Object.entries({
          SPEND: m.spend,
          IMPRESSIONS: m.impressions,
          CLICKS: m.clicks,
          PURCHASES: m.conversions,
        }).map(([field_type, field_value]) => ({ field_type, field_value })),
      },
      account("spotify", spotify.account.id, currency),
      query,
      configs.spotify,
      AT,
    ),
  x: (m, currency) =>
    xPerformance(
      {
        campaignId: X_CAMPAIGN,
        date: query.date_from,
        hour: null,
        offset: -360,
        raw: {},
        metrics: {
          billed_charge_local_micro: Math.round(m.spend * 1e6),
          impressions: m.impressions,
          clicks: m.clicks,
          conversion_purchases: m.conversions,
        },
      },
      account("x", x.account.id, currency),
      { id: X_CAMPAIGN, entity_status: "ACTIVE", currency },
      configs.x,
      AT,
    ),
};

describe("six providers preserve native currency and scaling invariants", () => {
  it.each(Object.keys(normalizers) as Array<keyof typeof normalizers>)(
    "%s preserves native amounts, fractional conversions, zeros and ratio scaling",
    (platform) => {
      const normalize = normalizers[platform];
      // Fixed generator: distinct sample magnitudes/denominators, no clock or random source.
      for (let seed = 0; seed < 32; seed++) {
        const sample = {
          spend: seed * 3.125,
          impressions: seed * 123,
          clicks: seed % 7,
          conversions: (seed % 5) * 0.5,
        };
        for (const currency of ["USD", "MXN"]) {
          const row = normalize(sample, currency);
          const scaled = normalize({ ...sample, spend: sample.spend * 8 }, currency);
          expect(row).toMatchObject({ ...sample, currency, date: query.date_from, hour: null, extracted_at: AT });
          expect(row.source_timezone).toBe(["microsoft", "spotify"].includes(platform) ? "UTC" : "America/Mexico_City");
          expect(scaled.ctr).toBe(row.ctr);
          for (const metric of ["cpc", "cpm", "cpa"] as const) {
            if (row[metric] === null) expect(scaled[metric]).toBeNull();
            else expect(scaled[metric]!).toBeCloseTo(row[metric]! * 8, 3);
          }
          if (sample.impressions === 0) expect(row.ctr).toBeNull();
          if (sample.clicks === 0) expect(row.cpc).toBeNull();
          if (sample.conversions === 0) expect(row.cpa).toBeNull();
          expect(Object.values(row).some((value) => typeof value === "number" && !Number.isFinite(value))).toBe(false);
        }
      }
    },
  );
});

describe("inclusive report windows preserve every leap and year boundary exactly once", () => {
  const splitters = {
    meta: (q: PerformanceQuery) => insightsWindows(q).map((w) => ({ from: w.date_from, to: w.date_to })),
    tiktok: (q: PerformanceQuery) => tiktokWindows(q).map((w) => ({ from: w.date_from, to: w.date_to })),
    spotify: (q: PerformanceQuery) => spotifyWindows(q, Date.parse("2027-01-01")),
    x: xWindows,
  };
  it.each(Object.keys(splitters) as Array<keyof typeof splitters>)(
    "%s covers its inclusive range with no gaps or overlaps",
    (platform) => {
      for (const dateFrom of ["2023-12-15", "2024-02-01", "2024-12-30", "2026-01-01"]) {
        for (const length of [1, 2, 29, 30, 31, 89, 90, 91, 366]) {
          const dateTo = new Date(Date.parse(dateFrom) + (length - 1) * DAY).toISOString().slice(0, 10);
          const windows = splitters[platform]({ ...query, date_from: dateFrom, date_to: dateTo });
          const dates = windows.flatMap((window) => {
            const out: string[] = [];
            for (let date = Date.parse(window.from); date <= Date.parse(window.to); date += DAY)
              out.push(new Date(date).toISOString().slice(0, 10));
            return out;
          });
          expect(dates).toHaveLength(length);
          expect(new Set(dates).size).toBe(length);
          expect(dates[0]).toBe(dateFrom);
          expect(dates.at(-1)).toBe(dateTo);
          dates.forEach((date, index) => expect(Date.parse(date)).toBe(Date.parse(dateFrom) + index * DAY));
        }
      }
    },
  );
});

describe("six-provider cancellation contract before transport", () => {
  const factories = {
    google: (request: typeof fetch) => new GoogleProvider(GOOGLE_ENV, { fetch: request }),
    meta: (request: typeof fetch) => new MetaProvider(meta.env, { fetch: request }),
    tiktok: (request: typeof fetch) => new TikTokProvider(tiktok.env, { fetch: request }),
    microsoft: (request: typeof fetch) => new MicrosoftProvider(MICROSOFT_ENV, { fetch: request }),
    spotify: (request: typeof fetch) => new SpotifyProvider(spotify.env, { fetch: request }),
    x: (request: typeof fetch) => new XProvider(x.env, { fetch: request }),
  };
  it.each(Object.keys(factories) as Array<keyof typeof factories>)(
    "%s rejects a cancelled read without OAuth, discovery or report requests",
    async (platform) => {
      let calls = 0;
      const provider = factories[platform](async () => {
        calls++;
        throw new Error("Unexpected offline transport");
      });
      const controller = new AbortController();
      controller.abort(new Error("PRIVATE_CALLER_REASON"));
      const failure = await provider
        .getPerformance(query, { signal: controller.signal })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "PROVIDER_TIMEOUT" });
      expect(calls).toBe(0);
      expect(JSON.stringify(failure)).not.toContain("PRIVATE_CALLER_REASON");
    },
  );
});
