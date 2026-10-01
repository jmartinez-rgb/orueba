import { describe, expect, it } from "vitest";
import { GoogleProvider } from "../src/providers/google/index.js";
import { GOOGLE_ENV, GoogleSimulator } from "./google-simulator.js";
import { MetaProvider } from "../src/providers/meta/index.js";
import { MetaSimulator } from "./meta-simulator.js";
import { insightsWindows } from "../src/providers/meta/queries.js";
import { SpotifyProvider } from "../src/providers/spotify/index.js";
import { SpotifySimulator, ACCOUNT as SPOTIFY_ACCOUNT, json } from "./spotify-simulator.js";
import { safeDownloadUrl, MICROSOFT_REPORT_HOST } from "../src/providers/microsoft/reports.js";
const day = { date_from: "2026-09-28", date_to: "2026-09-29", granularity: "daily" as const };
describe("continued audit: selected Google scalar defaults", () => {
  function setup(metrics: Record<string, unknown> | undefined) {
    const sim = new GoogleSimulator();
    sim.intercept = (call) =>
      String(call.body.query).includes("metrics.")
        ? Response.json({
            results: [
              {
                campaign: { id: "123" },
                segments: {
                  date: day.date_from,
                  conversionAction: "customers/2222222222/conversionActions/123",
                  conversionActionName: "MCC_Offline_Purchase",
                },
                ...(metrics === undefined ? {} : { metrics }),
              },
            ],
          })
        : undefined;
    return new GoogleProvider(GOOGLE_ENV, { fetch: sim.fetch, retry: { retries: 0 } });
  }
  it("decodes omitted selected scalar counts as zero in a returned metrics object", async () => {
    const row = (await setup({ impressions: "100" }).getPerformance({ ...day, account_id: "2222222222" }))[0]!;
    expect(row).toMatchObject({ clicks: 0, ctr: 0, spend: 0, conversions: 0, cpa: null, reach: null, video_25: null });
  });
  it("does not invent an object of metrics or fill missing report rows", async () => {
    await expect(setup(undefined).getPerformance({ ...day, account_id: "2222222222" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
  it("keeps explicitly null and invalid values distinct from omitted scalar defaults", async () => {
    const row = (
      await setup({ impressions: "100", clicks: null, conversions: "invalid" }).getPerformance({
        ...day,
        account_id: "2222222222",
      })
    )[0]!;
    expect(row).toMatchObject({ clicks: null, conversions: null, ctr: null });
  });
  it("preserves the exact Google offline event name", async () => {
    const row = (await setup({ allConversions: 3 }).getConversions({ ...day, account_id: "2222222222" }))[0]!;
    expect(row).toMatchObject({ conversions: 0, conversion_value: 0, source_conversion: "MCC_Offline_Purchase" });
    expect(row.raw_metrics).toMatchObject({ allConversions: 3 });
  });
});
describe("continued audit: bounded Google concurrency", () => {
  it("queries at most four enabled accounts at once and preserves discovery order", async () => {
    const sim = new GoogleSimulator(),
      ids = Array.from({ length: 9 }, (_, i) => String(2222222222 + i));
    let active = 0,
      maximum = 0;
    sim.intercept = (call) => {
      const query = String(call.body.query ?? "");
      if (query.includes(" FROM customer_client "))
        return Response.json({
          results: ids.map((id) => ({ customerClient: { id, level: "1", status: "ENABLED", manager: false } })),
        });
      if (query.includes("metrics.")) {
        return (async () => {
          active++;
          maximum = Math.max(active, maximum);
          await new Promise<void>((resolve) => setImmediate(resolve));
          active--;
          return Response.json({
            results: [{ campaign: { id: "123" }, segments: { date: day.date_from }, metrics: { impressions: "100" } }],
          });
        })();
      }
    };
    const p = new GoogleProvider(GOOGLE_ENV, { fetch: sim.fetch, retry: { retries: 0 } });
    const rows = await p.getPerformance(day);
    expect(rows.map((r) => r.account_id)).toEqual(ids);
    expect(maximum).toBe(4);
    expect(active).toBe(0);
  });
});
describe("continued audit: Meta date blocks", () => {
  it.each([false, true])("collects a 366-day report without overlapping days; conversions=%s", async (conversions) => {
    const sim = new MetaSimulator(),
      p = new MetaProvider(sim.env, { fetch: sim.fetch });
    sim.handler = (u) => {
      if (!u.pathname.endsWith("/insights")) return undefined;
      const { since, until } = JSON.parse(u.searchParams.get("time_range")!) as { since: string; until: string };
      const data = [];
      for (let start = Date.parse(since); start <= Date.parse(until); start += 86400000) {
        const date = new Date(start).toISOString().slice(0, 10);
        data.push({
          ...sim.insight,
          date_start: date,
          date_stop: date,
          spend: "10",
          actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "2" }],
          action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "50" }],
        });
      }
      return MetaSimulator.json({ data });
    };
    const query = { date_from: "2025-10-01", date_to: "2026-10-01", granularity: "daily" as const, account_id: "111" };
    const rows = await (conversions ? p.getConversions(query) : p.getPerformance(query));
    expect(rows).toHaveLength(366);
    expect(new Set(rows.map((r) => r.date)).size).toBe(366);
    expect(rows.reduce((sum, r) => sum + (r.conversions ?? 0), 0)).toBe(732);
    const requests = sim.calls.filter((c) => c.path.endsWith("/insights"));
    expect(requests).toHaveLength(13);
    for (const call of requests) {
      const range = JSON.parse(call.params.get("time_range")!);
      expect((Date.parse(range.until) - Date.parse(range.since)) / 86400000).toBeLessThan(30);
      expect(call.params.get("action_report_time")).toBe("impression");
    }
  });
  it("uses single-day hourly blocks without changing attribution", () => {
    const windows = insightsWindows({ ...day, granularity: "hourly" });
    expect(windows.map((q) => [q.date_from, q.date_to])).toEqual([
      ["2026-09-28", "2026-09-28"],
      ["2026-09-29", "2026-09-29"],
    ]);
  });
  it("rejects rows from a different block instead of counting them twice", async () => {
    const sim = new MetaSimulator(),
      p = new MetaProvider(sim.env, { fetch: sim.fetch });
    await expect(p.getPerformance({ ...day, date_from: "2026-08-01", account_id: "111" })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});
describe("continued audit: Spotify inclusive report end", () => {
  it("retains the last day of each 90-day block, matching the official inclusive contract", async () => {
    const sim = new SpotifySimulator(),
      p = new SpotifyProvider(sim.env, { fetch: sim.fetch });
    sim.handler = (u) => {
      if (!u.pathname.endsWith("/aggregate_reports")) return undefined;
      return json({ granularity: "DAY", rows: [], continuation_token: null });
    };
    await p.getPerformance({
      date_from: "2026-01-01",
      date_to: "2026-04-01",
      granularity: "daily",
      account_id: SPOTIFY_ACCOUNT,
    });
    const requests = sim.calls.filter((c) => c.path.endsWith("/aggregate_reports"));
    expect(requests.map((c) => [c.params.get("report_start"), c.params.get("report_end")])).toEqual([
      ["2026-01-01T00:00:00Z", "2026-03-31T00:00:00Z"],
      ["2026-04-01T00:00:00Z", "2026-04-01T00:00:00Z"],
    ]);
  });
});
describe("continued audit: trusted Microsoft download host", () => {
  it("rejects attacker-controlled public DNS before lookup", async () => {
    let lookups = 0;
    await expect(
      safeDownloadUrl("https://attacker.blob.core.windows.net/report", async () => {
        lookups++;
        return [{ address: "8.8.8.8", family: 4 }];
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(lookups).toBe(0);
  });
  it("still rejects a private resolution on the trusted vendor host", async () => {
    await expect(
      safeDownloadUrl(`https://${MICROSOFT_REPORT_HOST}/report`, async () => [{ address: "::1", family: 6 }]),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});
