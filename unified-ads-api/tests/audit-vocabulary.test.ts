import { describe, expect, it } from "vitest";
import { CONVERSION_CATEGORIES } from "../src/normalization/conversions.js";
import { GoogleProvider } from "../src/providers/google/index.js";
import { SpotifyProvider } from "../src/providers/spotify/index.js";
import { TikTokProvider } from "../src/providers/tiktok/index.js";
import { MetaProvider } from "../src/providers/meta/index.js";
import { GOOGLE_ENV, GoogleSimulator } from "./google-simulator.js";
import { ACCOUNT, SpotifySimulator } from "./spotify-simulator.js";
import { TikTokSimulator } from "./tiktok-simulator.js";
import { MetaSimulator } from "./meta-simulator.js";

// Auditoría: normalized_conversion debe usar el mismo vocabulario en todas las plataformas para que
// agrupar o comparar por categoría sea válido. Sin mapeos explícitos, solo etiquetas del catálogo común.
const day = { date_from: "2026-09-29", date_to: "2026-09-29", granularity: "daily" as const };
const allowed = new Set<string | null>([...CONVERSION_CATEGORIES, null]);

describe("auditoría: vocabulario común de conversiones", () => {
  it("Spotify usa las mismas etiquetas en mayúsculas que las demás plataformas", async () => {
    const sim = new SpotifySimulator();
    const provider = new SpotifyProvider(sim.env, { fetch: sim.fetch, retry: { sleep: async () => undefined } });
    const rows = await provider.getConversions({ ...day, account_id: ACCOUNT });
    expect(rows.find((r) => r.source_conversion === "LEADS")?.normalized_conversion).toBe("LEAD");
    expect(rows.find((r) => r.source_conversion === "PURCHASES")?.normalized_conversion).toBe("PURCHASE");
    for (const r of rows) expect(allowed.has(r.normalized_conversion)).toBe(true);
  });

  it("Google clasifica SIGNUP como registro, igual que TikTok y Spotify", async () => {
    const simulator = new GoogleSimulator();
    simulator.intercept = (call) =>
      String(call.body.query).includes("segments.conversion_action")
        ? Response.json({
            results: [
              {
                campaign: { id: "123" },
                segments: {
                  date: "2026-09-01",
                  conversionAction: "customers/2222222222/conversionActions/555",
                  conversionActionName: "Registro web",
                  conversionActionCategory: "SIGNUP",
                },
                metrics: { conversions: 4, conversionsValue: 0 },
              },
            ],
          })
        : undefined;
    const provider = new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } });
    const [row] = await provider.getConversions({
      account_id: "2222222222",
      date_from: "2026-09-01",
      date_to: "2026-09-02",
      granularity: "daily",
    });
    expect(row?.normalized_conversion).toBe("REGISTRATION");
  });

  it("TikTok y Meta sin mapeos explícitos solo emiten etiquetas del catálogo común", async () => {
    const tt = new TikTokSimulator();
    const tiktok = new TikTokProvider({ ...tt.env, TIKTOK_CONVERSION_MAPPING: "" }, { fetch: tt.fetch });
    const meta = new MetaSimulator();
    const metaProvider = new MetaProvider({ ...meta.env, META_CONVERSION_MAPPING: "" }, { fetch: meta.fetch });
    const rows = [
      ...(await tiktok.getConversions({ ...day, account_id: "7000000000000000011" })),
      ...(await metaProvider.getConversions({ ...day, account_id: "111" })),
    ];
    expect(rows.some((r) => r.platform === "tiktok")).toBe(true);
    expect(rows.some((r) => r.platform === "meta")).toBe(true);
    for (const r of rows) expect(allowed.has(r.normalized_conversion)).toBe(true);
  });
});
