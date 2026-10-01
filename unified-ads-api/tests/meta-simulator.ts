import { createHmac } from "node:crypto";
import type { MetaFetch, MetaInsight } from "../src/providers/meta/types.js";
import { HOUR_FIELD } from "../src/providers/meta/queries.js";

/** Transporte completamente local. Toda llamada no reconocida falla; nunca llama a fetch real. */
export class MetaSimulator {
  readonly env = {
    META_ACCESS_TOKEN: "meta-test-token-private",
    META_APP_SECRET: "meta-test-app-secret",
    META_CLIENT_MAPPING: '{"111":"cliente-a","222":"cliente-b"}',
    META_PRIMARY_CONVERSION_ACTION: "offsite_conversion.fb_pixel_purchase",
    META_CONVERSION_MAPPING: '{"onsite_conversion.messaging_conversation_started_7d":"CONTACT"}',
    META_RETRIES: "0",
  };
  readonly calls: Array<{ path: string; params: URLSearchParams; headers: Headers }> = [];
  handler?: (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;
  readonly account = {
    id: "act_111",
    account_id: "111",
    name: "Cuenta de prueba",
    currency: "MXN",
    timezone_name: "America/Mexico_City",
    account_status: 1,
    business: { id: "999" },
  };
  readonly campaign = {
    id: "333",
    name: "Campaña de prueba",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    objective: "OUTCOME_SALES",
  };
  readonly insight: MetaInsight = {
    account_id: "111",
    account_name: "Cuenta de prueba",
    account_currency: "MXN",
    campaign_id: "333",
    campaign_name: "Campaña de prueba",
    date_start: "2026-09-29",
    date_stop: "2026-09-29",
    spend: "100.50",
    impressions: "1000",
    reach: "500",
    frequency: "2",
    clicks: "20",
    inline_link_clicks: "15",
    actions: [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
      { action_type: "omni_purchase", value: "2" },
      { action_type: "purchase", value: "2" },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "4" },
      { action_type: "link_click", value: "15" },
    ],
    action_values: [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "800" },
      { action_type: "omni_purchase", value: "800" },
    ],
    video_play_actions: [{ action_type: "video_view", value: "100" }],
    video_p25_watched_actions: [{ action_type: "video_view", value: "80" }],
    video_p50_watched_actions: [{ action_type: "video_view", value: "50" }],
    video_p75_watched_actions: [{ action_type: "video_view", value: "30" }],
    video_p100_watched_actions: [{ action_type: "video_view", value: "10" }],
  };
  static json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }
  static error(code: number, status = 400, headers: Record<string, string> = {}) {
    return this.json(
      {
        error: {
          code,
          error_subcode: 463,
          message: "meta-test-token-private",
          error_user_msg: "meta-test-app-secret",
          fbtrace_id: "trace-test",
        },
      },
      status,
      headers,
    );
  }
  readonly fetch: MetaFetch = async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init?.headers);
    if (
      url.origin !== "https://graph.facebook.com" ||
      init?.method !== "GET" ||
      init.redirect !== "error" ||
      headers.get("authorization") !== `Bearer ${this.env.META_ACCESS_TOKEN}` ||
      url.searchParams.has("access_token")
    )
      throw new Error("Solicitud insegura o inesperada en simulador Meta");
    const proof = createHmac("sha256", this.env.META_APP_SECRET).update(this.env.META_ACCESS_TOKEN).digest("hex");
    if (url.searchParams.get("appsecret_proof") !== proof) throw new Error("Falta appsecret_proof válido");
    this.calls.push({ path: url.pathname, params: url.searchParams, headers });
    const response = await this.handler?.(url, init);
    if (response) return response;
    const path = url.pathname.replace(/^\/v(?:25|26)\.0\//, "");
    const account = {
      ...this.account,
      business: url.searchParams.get("fields")?.split(",").includes("business") ? this.account.business : undefined,
    };
    if (path === "me/adaccounts" || path === "999/owned_ad_accounts" || path === "999/client_ad_accounts")
      return MetaSimulator.json({ data: [account] });
    if (path === "act_111") return MetaSimulator.json(account);
    if (path === "act_222") return MetaSimulator.json({ ...account, id: "act_222", account_id: "222" });
    if (path === "act_111/campaigns" || path === "act_222/campaigns")
      return MetaSimulator.json({ data: [this.campaign] });
    if (path === "act_111/insights" || path === "act_222/insights") {
      const row: MetaInsight = { ...this.insight, account_id: path.includes("222") ? "222" : "111" };
      if (url.searchParams.has("breakdowns")) row[HOUR_FIELD] = "00:00:00 - 00:59:59";
      return MetaSimulator.json({ data: [row] });
    }
    throw new Error("Ruta desconocida en simulador Meta");
  };
}
