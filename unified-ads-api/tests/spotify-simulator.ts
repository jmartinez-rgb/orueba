import { spotifyBasic, type SpotifyFetch } from "../src/providers/spotify/client.js";

export const BUSINESS = "00000000-0000-4000-8000-000000000001";
export const ACCOUNT = "00000000-0000-4000-8000-000000000002";
export const SECOND = "00000000-0000-4000-8000-000000000003";
export const CAMPAIGN = "00000000-0000-4000-8000-000000000004";
export const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

/** Fixed official Ads v3 transport; unknown destinations fail locally and never reach the network. */
export class SpotifySimulator {
  readonly env = {
    SPOTIFY_ADS_CLIENT_ID: "synthetic-spotify-client",
    SPOTIFY_ADS_CLIENT_SECRET: "synthetic-spotify-secret",
    SPOTIFY_ADS_REFRESH_TOKEN: "synthetic-spotify-refresh",
    SPOTIFY_ADS_CLIENT_MAPPING: JSON.stringify({ [ACCOUNT]: "cliente-a" }),
    SPOTIFY_ADS_RETRIES: "0",
  };
  readonly calls: Array<{ path: string; params: URLSearchParams; headers: Headers; form: URLSearchParams }> = [];
  handler?: (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;
  readonly account = {
    id: ACCOUNT,
    business_id: BUSINESS,
    name: "Cuenta Spotify",
    status: "ACTIVE",
    currency_code: "MXN",
    billing_address: "PRIVATE_BILLING",
    tax_id: "PRIVATE_TAX",
  };
  readonly campaign = {
    id: CAMPAIGN,
    name: "Campaña Spotify",
    status: "ACTIVE",
    delivery_goal_group: "WEBSITE_VISITS",
    objective: "REACH",
  };
  report(granularity = "DAY", date = "2026-09-29", metrics: Record<string, number | null> = {}) {
    const values = {
      SPEND: 100.5,
      IMPRESSIONS: 1000,
      CLICKS: 20,
      REACH: 500,
      FREQUENCY: 2,
      VIDEO_VIEWS: 100,
      FIRST_QUARTILES: 80,
      MIDPOINTS: 50,
      THIRD_QUARTILES: 30,
      COMPLETES: 10,
      PURCHASES: 2,
      LEADS: 3,
      CUSTOM_EVENT_1: 0,
      CUSTOM_EVENT_2: null,
      REVENUE: 800,
      ...metrics,
    };
    const row = {
      entity_type: "CAMPAIGN",
      entity_id: CAMPAIGN,
      entity_name: "Campaña Spotify",
      entity_status: "ACTIVE",
      start_time: date + "T00:00:00Z",
      end_time: new Date(Date.parse(date) + (granularity === "HOUR" ? 3600000 : 86400000)).toISOString(),
      stats: Object.entries(values).map(([field_type, field_value]) => ({ field_type, field_value })),
    };
    return {
      granularity,
      report_start: row.start_time,
      report_end: row.end_time,
      continuation_token: null,
      rows: [row],
      warnings: [],
    };
  }
  readonly fetch: SpotifyFetch = async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init?.headers),
      form = new URLSearchParams(String(init?.body ?? ""));
    if (init?.redirect !== "error") throw new Error("Spotify simulator requires redirect rejection");
    if (url.origin === "https://accounts.spotify.com" && url.pathname === "/api/token") {
      if (
        init.method !== "POST" ||
        headers.get("authorization") !==
          spotifyBasic(this.env.SPOTIFY_ADS_CLIENT_ID, this.env.SPOTIFY_ADS_CLIENT_SECRET) ||
        form.get("grant_type") !== "refresh_token"
      )
        throw new Error("Unexpected Spotify OAuth request");
    } else if (
      url.origin !== "https://api-partner.spotify.com" ||
      !url.pathname.startsWith("/ads/v3/") ||
      init.method !== "GET" ||
      headers.get("authorization") !== "Bearer synthetic-spotify-access" ||
      url.searchParams.has("access_token")
    )
      throw new Error("Unexpected Spotify Ads request");
    this.calls.push({ path: url.pathname, params: url.searchParams, headers, form });
    const custom = await this.handler?.(url, init);
    if (custom) return custom;
    if (url.pathname === "/api/token")
      return json({
        access_token: "synthetic-spotify-access",
        refresh_token: "synthetic-rotated-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    const path = url.pathname.replace("/ads/v3", "");
    if (path === "/businesses")
      return json({ businesses: [{ id: BUSINESS, name: "Negocio Spotify", status: "ACTIVE" }] });
    if (path === `/businesses/${BUSINESS}/ad_accounts`) return json({ ad_accounts: [this.account] });
    if (path === `/ad_accounts/${ACCOUNT}` || path === `/ad_accounts/${SECOND}`)
      return json({ ...this.account, id: path.split("/")[2] });
    if (path === `/ad_accounts/${ACCOUNT}/campaigns` || path === `/ad_accounts/${SECOND}/campaigns`)
      return json({ campaigns: [this.campaign], paging: { offset: 0, total_results: 1, page_size: 50 } });
    if (path === `/ad_accounts/${ACCOUNT}/aggregate_reports` || path === `/ad_accounts/${SECOND}/aggregate_reports`) {
      const body = this.report(
        url.searchParams.get("granularity") ?? "DAY",
        url.searchParams.get("report_start")?.slice(0, 10),
      );
      const fields = url.searchParams.getAll("fields");
      body.rows[0]!.stats = body.rows[0]!.stats.filter((s) => fields.includes(s.field_type));
      return json(body);
    }
    throw new Error("Unknown route in Spotify simulator");
  };
}
