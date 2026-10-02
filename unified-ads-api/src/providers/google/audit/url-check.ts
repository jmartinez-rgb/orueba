import type { UrlCheck } from "./types.js";

/**
 * Revisión HTTP de páginas de destino: una petición GET sin cookies ni JavaScript (no registra visitas
 * en analítica), sin seguir redirecciones, con tiempo máximo. Un 403/429/503 suele ser protección
 * contra bots: se informa como "no verificable", nunca como error.
 */
export function classifyStatus(status: number): UrlCheck["outcome"] {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 404 || status === 410 || status === 500 || status === 502 || status === 504) return "error";
  return "unverifiable";
}

export async function checkUrls(
  urls: string[],
  request: typeof fetch = fetch,
  timeoutMs = 10000,
  concurrency = 4,
): Promise<UrlCheck[]> {
  const out: UrlCheck[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i]!;
      try {
        const res = await request(url, {
          method: "GET",
          redirect: "manual",
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; revision-de-landing-pages; solo lectura)",
            accept: "text/html",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        await res.body?.cancel().catch(() => undefined);
        out[i] = {
          url,
          status: res.status,
          location: res.headers.get("location"),
          outcome: classifyStatus(res.status),
        };
      } catch {
        out[i] = { url, status: null, location: null, outcome: "unverifiable" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return out;
}
