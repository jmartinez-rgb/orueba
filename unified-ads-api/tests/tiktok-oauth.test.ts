import { describe, expect, it, vi } from "vitest";
import { exchangeTikTokCode, tiktokAuthCode } from "../src/providers/tiktok/oauth.js";

const SECRET = "app-secret-PRIVADO-123";
const TOKEN = "act.token-PRIVADO-456";

describe("TikTok: canje de la autorización", () => {
  it("toma el auth_code de la URL de retorno (o el código solo) y rechaza cancelaciones", () => {
    expect(tiktokAuthCode("https://mi-app.mx/tiktok/callback?auth_code=abc123XYZ_-.&code=abc123XYZ_-.&state=s1")).toBe(
      "abc123XYZ_-.",
    );
    expect(tiktokAuthCode("https://mi-app.mx/cb?code=solo-code-123")).toBe("solo-code-123");
    expect(tiktokAuthCode("  codigo-directo-123  ")).toBe("codigo-directo-123");
    expect(() => tiktokAuthCode("https://mi-app.mx/cb?error=access_denied")).toThrow(/cancel/);
    expect(() => tiktokAuthCode("https://mi-app.mx/cb?state=x")).toThrow(/auth_code/);
  });

  it("canjea con app_id, secret y auth_code y devuelve token y cuentas autorizadas", async () => {
    const request = vi.fn(async () =>
      Response.json({
        code: 0,
        message: "OK",
        data: { access_token: TOKEN, advertiser_ids: ["7000000000000000011", 7000000000000002, "x"], scope: [4, 1] },
      }),
    );
    const r = await exchangeTikTokCode(
      { appId: "7123", secret: SECRET, authCode: "code-123456" },
      request as unknown as typeof fetch,
    );
    expect(r).toEqual({
      accessToken: TOKEN,
      advertiserIds: ["7000000000000000011", "7000000000000002"],
      scope: [4, 1],
    });
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ app_id: "7123", secret: SECRET, auth_code: "code-123456" });
    expect(init.redirect).toBe("error");
  });

  it("un código vencido o usado se explica sin repetir secretos", async () => {
    const request = vi.fn(async () => Response.json({ code: 40002, message: `auth_code invalid ${SECRET}`, data: {} }));
    const err = await exchangeTikTokCode(
      { appId: "7123", secret: SECRET, authCode: "code-123456" },
      request as unknown as typeof fetch,
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "INVALID_REQUEST" });
    expect(JSON.stringify({ m: (err as Error).message, d: (err as { details: unknown }).details })).not.toContain(
      SECRET,
    );
  });

  it("credenciales de la app inválidas y respuestas sin token fallan con error claro", async () => {
    const bad = vi.fn(async () => Response.json({ code: 40101, message: "invalid secret", data: {} }));
    await expect(
      exchangeTikTokCode({ appId: "7123", secret: SECRET, authCode: "code-123456" }, bad as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
    const empty = vi.fn(async () => Response.json({ code: 0, data: {} }));
    await expect(
      exchangeTikTokCode({ appId: "7123", secret: SECRET, authCode: "code-123456" }, empty as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});
