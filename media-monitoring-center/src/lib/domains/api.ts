import { googleDomainsSchema, type GoogleDomainConfig } from "./config";

/** Bounded request used by the extractor, never by a page or an OAuth callback. */
export async function fetchGoogleDomainConfig(options: { base: string | URL; apiKey: string; request?: typeof fetch; timeoutMs?: number }): Promise<GoogleDomainConfig> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new Error("DOMAIN_CONFIGURATION_TIMEOUT_INVALID");
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("DOMAIN_CONFIGURATION_TIMEOUT")); }, timeoutMs); });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const pending = (options.request ?? fetch)(new URL("/api/v1/google-domains", options.base), { headers: { Accept: "application/json", "X-API-Key": options.apiKey }, signal: controller.signal, redirect: "error", cache: "no-store" }).then(response => {
      if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined);
      return response;
    });
    const response = await Promise.race([pending, deadline]);
    if (!response.ok || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) { void response.body?.cancel().catch(() => undefined); throw new Error("DOMAIN_CONFIGURATION_UNAVAILABLE"); }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 64 * 1024) throw new Error("DOMAIN_CONFIGURATION_LIMIT");
      chunks.push(chunk.value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return googleDomainsSchema.parse(body?.data);
  } finally {
    clearTimeout(timer!);
    if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
