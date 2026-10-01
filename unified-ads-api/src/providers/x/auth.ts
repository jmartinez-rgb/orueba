import { createHmac, randomBytes } from "node:crypto";
import type { XConfig } from "./config.js";

/** RFC 5849: encode first, sort by encoded key/value, include duplicate query parameters. */
export const oauthEncode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function oauthHeader(
  method: string,
  url: URL,
  config: Pick<XConfig, "consumerKey" | "consumerSecret" | "accessToken" | "accessTokenSecret">,
  opts: { nonce?: string; timestamp?: number; form?: URLSearchParams; includeVersion?: boolean } = {},
) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_token: config.accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_nonce: opts.nonce ?? randomBytes(24).toString("hex"),
    ...(opts.includeVersion === false ? {} : { oauth_version: "1.0" }),
  };
  const params = [...url.searchParams, ...(opts.form ?? []), ...Object.entries(oauth)]
    .filter(([key]) => key !== "oauth_signature")
    .map(([k, v]) => [oauthEncode(k), oauthEncode(v)] as const);
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const normalized = params.map(([k, v]) => `${k}=${v}`).join("&");
  const base = [method.toUpperCase(), url.origin + url.pathname, normalized].map(oauthEncode).join("&");
  oauth.oauth_signature = createHmac(
    "sha1",
    `${oauthEncode(config.consumerSecret)}&${oauthEncode(config.accessTokenSecret)}`,
  )
    .update(base)
    .digest("base64");
  return (
    "OAuth " +
    Object.entries(oauth)
      .sort()
      .map(([k, v]) => `${oauthEncode(k)}="${oauthEncode(v)}"`)
      .join(", ")
  );
}
