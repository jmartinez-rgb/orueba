import type { TikTokFetch, TikTokReport } from "../src/providers/tiktok/types.js";

/** Transporte cerrado: ninguna prueba puede consultar la red real. IDs de 64 bits en texto. */
export class TikTokSimulator {
  readonly env = {
    TIKTOK_APP_ID: "7000000000000000001",
    TIKTOK_APP_SECRET: "tiktok-test-secret-private",
    TIKTOK_ACCESS_TOKEN: "tiktok-test-token-private",
    TIKTOK_RETRIES: "0",
    TIKTOK_CLIENT_MAPPING: '{"7000000000000000011":"cliente-a","7000000000000000022":"cliente-b"}',
  };
  readonly account = {
    advertiser_id: "7000000000000000011",
    name: "Cuenta TikTok",
    currency: "MXN",
    timezone: "Etc/GMT+6",
    display_timezone: "America/Mexico_City",
    status: "STATUS_ENABLE",
    owner_bc_id: "7000000000000000099",
  };
  readonly campaign = {
    advertiser_id: this.account.advertiser_id,
    campaign_id: "7000000000000000033",
    campaign_name: "Campaña TikTok",
    operation_status: "ENABLE",
    secondary_status: "CAMPAIGN_STATUS_ENABLE",
    objective_type: "CONVERSIONS",
  };
  readonly report: TikTokReport = {
    dimensions: { campaign_id: this.campaign.campaign_id, stat_time_day: "2026-09-29 00:00:00" },
    metrics: {
      campaign_name: this.campaign.campaign_name,
      objective_type: "CONVERSIONS",
      spend: "100.50",
      impressions: "1000",
      clicks: "20",
      conversion: "5",
      reach: "500",
      frequency: "2",
      video_play_actions: "100",
      video_views_p25: "80",
      video_views_p50: "50",
      video_views_p75: "30",
      video_views_p100: "10",
      complete_payment: "2",
      total_complete_payment_rate: "800",
      form: "3",
      onsite_form: "4",
      total_purchase: "2",
      total_purchase_value: "600",
      total_registration: "1",
      on_web_order: "3",
      onsite_shopping: "1",
      total_onsite_shopping_value: "400",
    },
  };
  readonly calls: Array<{ path: string; params: URLSearchParams; headers: Headers }> = [];
  handler?: (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;
  static json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }
  static ok(data: unknown) {
    return this.json({ code: 0, message: "OK", data });
  }
  static list(rows: unknown[], page = 1, totalPage = 1, extra: Record<string, unknown> = {}) {
    return this.ok({
      list: rows,
      page_info: { page, page_size: 1000, total_page: totalPage, total_number: rows.length },
      ...extra,
    });
  }
  static error(code: number, status = 200, headers: Record<string, string> = {}) {
    return this.json(
      {
        code,
        message: "tiktok-test-token-private",
        subcode: "tiktok-test-secret-private",
        request_id: "tiktok-test-token-private",
        data: {},
      },
      status,
      headers,
    );
  }
  readonly fetch: TikTokFetch = async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init?.headers);
    if (
      url.origin !== "https://business-api.tiktok.com" ||
      !url.pathname.startsWith("/open_api/v1.3/") ||
      init?.method !== "GET" ||
      init.redirect !== "error" ||
      headers.get("Access-Token") !== this.env.TIKTOK_ACCESS_TOKEN ||
      url.searchParams.has("access_token")
    )
      throw new Error("Solicitud insegura o inesperada en simulador TikTok");
    const path = url.pathname.replace("/open_api/v1.3/", "");
    if (path === "oauth2/advertiser/get/") {
      if (
        url.searchParams.get("app_id") !== this.env.TIKTOK_APP_ID ||
        url.searchParams.get("secret") !== this.env.TIKTOK_APP_SECRET
      )
        throw new Error("Faltan credenciales de discovery en el simulador");
    } else if (url.searchParams.has("secret") || url.searchParams.has("app_id"))
      throw new Error("Credenciales fuera de discovery");
    this.calls.push({ path, params: url.searchParams, headers });
    const response = await this.handler?.(url, init);
    if (response) return response;
    if (path === "oauth2/advertiser/get/")
      return TikTokSimulator.ok({
        list: [{ advertiser_id: this.account.advertiser_id, advertiser_name: this.account.name }],
      });
    if (path === "advertiser/info/") {
      const ids = JSON.parse(url.searchParams.get("advertiser_ids")!) as string[];
      return TikTokSimulator.ok({ list: ids.map((id) => ({ ...this.account, advertiser_id: id })) });
    }
    if (path === "campaign/get/")
      return TikTokSimulator.list(
        [{ ...this.campaign, advertiser_id: url.searchParams.get("advertiser_id") }],
        Number(url.searchParams.get("page")),
      );
    if (path === "report/integrated/get/") {
      const requested = JSON.parse(url.searchParams.get("metrics")!) as string[];
      const hourly = (JSON.parse(url.searchParams.get("dimensions")!) as string[]).includes("stat_time_hour");
      const date = url.searchParams.get("start_date")!;
      const row = {
        dimensions: {
          campaign_id: this.campaign.campaign_id,
          [hourly ? "stat_time_hour" : "stat_time_day"]: `${date} 00:00:00`,
        },
        metrics: Object.fromEntries(Object.entries(this.report.metrics!).filter(([key]) => requested.includes(key))),
      };
      return TikTokSimulator.list([row], Number(url.searchParams.get("page")));
    }
    throw new Error("Ruta desconocida en simulador TikTok");
  };
}
