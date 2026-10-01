import type { GoogleFetch, GoogleRow } from "../src/providers/google/types.js";

export const GOOGLE_ENV = {
  GOOGLE_ADS_CLIENT_ID: "test-client",
  GOOGLE_ADS_CLIENT_SECRET: "test-client-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "test-refresh-token",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "111-111-1111",
  GOOGLE_ADS_CLIENT_MAPPING: '{"2222222222":"client-a","3333333333":"client-b"}',
};

export interface GoogleCall {
  url: URL;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal: AbortSignal | null;
}

export function failure(family: string, code: string, message = "upstream message") {
  return {
    error: {
      code: 403,
      status: "PERMISSION_DENIED",
      message,
      details: [
        {
          "@type": "type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
          requestId: "google-request-123",
          errors: [{ errorCode: { [family]: code }, message }],
        },
      ],
    },
  };
}

/** Simulador estricto: no llama a fetch ni permite otras URLs o consultas. */
export class GoogleSimulator {
  calls: GoogleCall[] = [];
  tokens = 0;
  faults: Array<{ match: string; status: number; body: unknown; headers?: Record<string, string> }> = [];
  intercept?: (call: GoogleCall) => Response | Promise<Response> | undefined;
  metricOverrides: Record<string, unknown> = {};
  repeatPage = false;
  readonly fetch: GoogleFetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (!["oauth2.googleapis.com", "googleads.googleapis.com"].includes(url.hostname))
      throw new Error(`Unexpected host: ${url.hostname}`);
    const text = req.method === "GET" ? "" : await req.text();
    const body = text.startsWith("{")
      ? (JSON.parse(text) as Record<string, unknown>)
      : Object.fromEntries(new URLSearchParams(text));
    const call = { url, method: req.method, headers: req.headers, body, signal: req.signal };
    this.calls.push(call);
    const intercepted = this.intercept?.(call);
    if (intercepted !== undefined) return intercepted;
    const fault = this.faults[0];
    if (fault && url.pathname.includes(fault.match)) {
      this.faults.shift();
      return Response.json(fault.body, { status: fault.status, headers: fault.headers });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      if (req.method !== "POST") throw new Error("Token must be POST");
      this.tokens++;
      return Response.json({ access_token: `test-access-${this.tokens}`, expires_in: 3600, token_type: "Bearer" });
    }
    if (!req.headers.get("authorization")?.startsWith("Bearer test-access-")) throw new Error("Missing OAuth");
    if (/^\/v(?:24|25)\/customers:listAccessibleCustomers$/.test(url.pathname))
      return Response.json({ resourceNames: ["customers/1111111111"] });
    const path = /^\/v(?:24|25)\/customers\/(\d{10})\/googleAds:search$/.exec(url.pathname);
    if (!path || req.method !== "POST" || typeof body.query !== "string") throw new Error("Unexpected Google endpoint");
    if ("pageSize" in body || "page_size" in body) throw new Error("Google does not support page_size");
    const id = path[1]!;
    const query = body.query;
    if (query.endsWith(" FROM customer")) {
      if (!["1111111111", "2222222222", "3333333333"].includes(id))
        return Response.json(failure("authenticationError", "CUSTOMER_NOT_FOUND"), { status: 400 });
      return Response.json({
        results: [
          {
            customer: {
              id,
              descriptiveName: id === "1111111111" ? "MCC" : `Account ${id}`,
              currencyCode: id === "2222222222" ? "USD" : "MXN",
              timeZone: "America/Mexico_City",
              manager: id === "1111111111",
              status: "ENABLED",
            },
          },
        ],
      });
    }
    if (query.includes(" FROM customer_client ")) {
      if (call.headers.get("login-customer-id") !== "1111111111") throw new Error("Missing MCC header");
      return Response.json({
        results: ["2222222222", "3333333333"].map((c, i) => ({
          customerClient: {
            id: c,
            descriptiveName: `Account ${c}`,
            currencyCode: i ? "MXN" : "USD",
            timeZone: "America/Mexico_City",
            manager: false,
            status: "ENABLED",
            level: String(i + 1),
          },
        })),
      });
    }
    if (!query.includes(" FROM campaign")) throw new Error("Unexpected GAQL");
    const camp = { id: "123456789012", name: "Search campaign", status: "ENABLED", advertisingChannelType: "SEARCH" };
    if (!query.includes("metrics.")) {
      return Response.json(
        body.pageToken
          ? {
              results: [{ campaign: { ...camp, id: "123456789014", status: "REMOVED" } }],
              ...(this.repeatPage ? { nextPageToken: "second-page" } : {}),
            }
          : {
              results: [{ campaign: camp }, { campaign: { ...camp, id: "123456789013", status: "PAUSED" } }],
              nextPageToken: "second-page",
            },
      );
    }
    const date = /BETWEEN '([^']+)'/.exec(query)?.[1];
    if (!date) throw new Error("No date filter");
    const hour = query.includes("segments.hour") ? { hour: 0 } : {};
    const segments = { date, ...hour };
    let row: GoogleRow;
    if (query.includes("segments.conversion_action")) {
      if (query.includes("cost_micros")) throw new Error("Costs cannot be segmented by conversion action");
      row = {
        campaign: camp,
        segments: {
          ...segments,
          conversionAction: `customers/${id}/conversionActions/987`,
          conversionActionName: "Offline purchase",
          conversionActionCategory: "PURCHASE",
        },
        metrics: {
          conversions: 1.5,
          conversionsValue: 49.9,
          allConversions: 2.5,
          allConversionsValue: 79.9,
          ...this.metricOverrides,
        },
      };
    } else {
      if (!query.includes("metrics.video_trueview_views") || query.includes("metrics.video_views,"))
        throw new Error("Wrong v25 video field");
      row = {
        campaign: camp,
        customer: { id, currencyCode: id === "2222222222" ? "USD" : "MXN", timeZone: "America/Mexico_City" },
        segments,
        metrics: {
          costMicros: "25000000",
          impressions: "1000",
          clicks: "10",
          conversions: 2.5,
          conversionsValue: 49.9,
          videoTrueviewViews: "40",
          videoQuartileP25Rate: 0.4,
          ...this.metricOverrides,
        },
      };
    }
    return Response.json({ results: [row] });
  };
}
