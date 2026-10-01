import { gzipSync } from "node:zlib";
export const ACCOUNT = "18ce54d4x5t",
  SECOND = "18ce54d4x6t",
  CAMPAIGN = "dvcz7";
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });
/** Synthetic fixture using the documented v12 shape; never calls the network. */
export class XSimulator {
  readonly env = {
    X_ADS_CONSUMER_KEY: "synthetic-consumer",
    X_ADS_CONSUMER_SECRET: "synthetic-consumer-secret",
    X_ADS_ACCESS_TOKEN: "synthetic-token",
    X_ADS_ACCESS_TOKEN_SECRET: "synthetic-token-secret",
    X_ADS_ACCOUNT_IDS: ACCOUNT,
    X_ADS_RETRIES: "0",
  };
  account = {
    id: ACCOUNT,
    name: "Cuenta X",
    timezone: "America/Mexico_City",
    timezone_switch_at: "2016-07-21T06:00:00Z",
    approval_status: "ACCEPTED",
    deleted: false,
  };
  campaigns: Record<string, unknown>[] = [
    { id: CAMPAIGN, name: "Campaña X", entity_status: "ACTIVE", currency: "MXN", deleted: false },
  ];
  calls: Array<{ url: URL; init: RequestInit }> = [];
  handler?: (url: URL, init: RequestInit) => Response | undefined | Promise<Response | undefined>;
  private jobs = new Map<string, URL>();
  private sequence = 0;
  stats(url: URL) {
    const n =
      (Date.parse(url.searchParams.get("end_time")!) - Date.parse(url.searchParams.get("start_time")!)) /
      (url.searchParams.get("granularity") === "HOUR" ? 3600000 : 86400000);
    const placement = url.searchParams.get("placement"),
      factor = placement === "SPOTLIGHT" ? 2 : placement === "TREND" ? 4 : 1;
    const series = (v: number) => Array.from({ length: n }, () => v);
    const metrics =
      url.searchParams.get("metric_groups") === "WEB_CONVERSION"
        ? {
            conversion_purchases: {
              post_engagement: series(factor === 1 ? 2 : 1),
              post_view: series(5),
              sale_amount: series(100),
            },
            conversion_sign_ups: { post_engagement: series(1), post_view: series(0) },
          }
        : {
            impressions: series(100),
            clicks: series(10),
            url_clicks: series(3),
            billed_charge_local_micro: series(factor * 1000000),
            video_total_views: series(7),
            video_views_25: series(5),
          };
    return {
      request: { params: Object.fromEntries(url.searchParams) },
      data_type: "stats",
      time_series_length: n,
      data: url.searchParams
        .get("entity_ids")!
        .split(",")
        .map((id) => ({ id, id_data: [{ segment: null, metrics }] })),
    };
  }
  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    this.calls.push({ url, init });
    const custom = await this.handler?.(url, init);
    if (custom) return custom;
    if (url.hostname === "ton.twimg.com") {
      const id = /stats_job_(\d+)\./.exec(url.pathname)?.[1];
      const source = this.jobs.get(id!);
      if (!source) throw new Error("Unexpected synthetic job.");
      return new Response(gzipSync(JSON.stringify(this.stats(source))));
    }
    if (
      url.hostname !== "ads-api.x.com" ||
      init.redirect !== "error" ||
      !String((init.headers as Record<string, string>)?.Authorization).startsWith("OAuth ")
    )
      throw new Error("Unexpected synthetic transport.");
    if (url.pathname === "/12/accounts") return json({ data: [this.account], next_cursor: null });
    if (url.pathname === `/12/accounts/${ACCOUNT}`) return json({ data: this.account });
    if (url.pathname.endsWith("/funding_instruments"))
      return json({ data: [{ id: "fund1", currency: "MXN" }], next_cursor: null });
    if (url.pathname.endsWith("/campaigns")) return json({ data: this.campaigns, next_cursor: null });
    if (url.pathname.startsWith("/12/stats/jobs/accounts/")) {
      if (init.method === "POST") {
        const id = String(1120829647711653888n + BigInt(this.sequence++));
        this.jobs.set(id, url);
        return json({ data: { id_str: id, id: Number(id), status: "PROCESSING", url: null } });
      }
      const id = url.searchParams.get("job_ids")!;
      return json({
        data: [
          {
            id_str: id,
            status: "SUCCESS",
            url: `https://ton.twimg.com/advertiser-api-async-analytics/stats_job_${id}.json.gz`,
          },
        ],
      });
    }
    if (url.pathname.startsWith("/12/stats/accounts/")) return json(this.stats(url));
    return json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  };
}
