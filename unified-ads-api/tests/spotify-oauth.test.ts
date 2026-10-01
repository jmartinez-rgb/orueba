import { describe, expect, it } from "vitest";
import {
  createSpotifyOAuthRequest,
  spotifyAuthorizationCode,
  exchangeSpotifyCode,
  SPOTIFY_REDIRECT,
} from "../src/providers/spotify/oauth.js";
import { spotifyBasic } from "../src/providers/spotify/client.js";
import { updateEnvVariable } from "../src/providers/google/oauth.js";
import { json } from "./spotify-simulator.js";

const start = () => createSpotifyOAuthRequest("synthetic-client");
describe("Spotify confidential OAuth in a browser-only cloud workspace", () => {
  it("uses Ads API's documented scope-free authorization flow and unique state", () => {
    const { url, session } = start(),
      u = new URL(url);
    expect(u.origin).toBe("https://accounts.spotify.com");
    expect(u.pathname).toBe("/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe(SPOTIFY_REDIRECT);
    expect(u.searchParams.has("scope")).toBe(false);
    expect(u.searchParams.has("client_secret")).toBe(false);
    expect(session.state).not.toBe(start().session.state);
  });
  it.each([
    "http://localhost:8089/oauth/spotify/callback",
    "https://attacker.test/callback",
    "http://127.0.0.1:8089/callback?code=x",
    "http://user:secret@127.0.0.1:8089/callback",
  ])("rejects unsafe or unsupported redirect %s", (uri) => {
    expect(() => createSpotifyOAuthRequest("synthetic-client", uri)).toThrow();
  });
  it("decodes the authorization code once without losing plus signs", () => {
    const { session } = start();
    expect(spotifyAuthorizationCode(`${session.redirectUri}?code=abc%2B123%252B&state=${session.state}`, session)).toBe(
      "abc+123%2B",
    );
  });
  it.each([
    "missing-state",
    "wrong-state",
    "duplicate-state",
    "duplicate-code",
    "wrong-path",
    "wrong-origin",
    "cancelled",
    "expired",
    "future",
    "fragment",
  ])("rejects %s without exposing the callback", (failure) => {
    const { session } = start(),
      u = new URL(session.redirectUri);
    u.search = new URLSearchParams({ code: "PRIVATE_CODE", state: session.state }).toString();
    if (failure === "missing-state") u.searchParams.delete("state");
    if (failure === "wrong-state") u.searchParams.set("state", "wrong");
    if (failure === "duplicate-state") u.searchParams.append("state", session.state);
    if (failure === "duplicate-code") u.searchParams.append("code", "second");
    if (failure === "wrong-path") u.pathname = "/wrong";
    if (failure === "wrong-origin") u.hostname = "attacker.test";
    if (failure === "cancelled") u.searchParams.set("error", "access_denied");
    if (failure === "expired") session.createdAt -= 30 * 60000;
    if (failure === "future") session.createdAt += 60000;
    if (failure === "fragment") u.hash = "extra";
    expect(() => spotifyAuthorizationCode(u.toString(), session)).toThrow();
    try {
      spotifyAuthorizationCode(u.toString(), session);
    } catch (e) {
      expect(String(e)).not.toContain("PRIVATE_CODE");
    }
  });
  it("exchanges the code via Basic client credentials, exact redirect and fixed token endpoint", async () => {
    const { session } = start();
    const result = await exchangeSpotifyCode(
      session,
      "private-secret",
      `${session.redirectUri}?code=private-code&state=${session.state}`,
      async (url, init) => {
        expect(String(url)).toBe("https://accounts.spotify.com/api/token");
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          spotifyBasic("synthetic-client", "private-secret"),
        );
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("redirect_uri")).toBe(session.redirectUri);
        expect(form.get("code")).toBe("private-code");
        expect(form.has("client_secret")).toBe(false);
        return json({
          access_token: "private-access",
          refresh_token: "private-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    );
    expect(result).toBe("private-refresh");
  });
  it("allows a fresh code after the user spent more than ten minutes before authorizing", async () => {
    const { session } = start();
    session.createdAt -= 11 * 60000;
    const token = await exchangeSpotifyCode(
      session,
      "private-secret",
      `${session.redirectUri}?code=fresh-code&state=${session.state}`,
      async () =>
        json({
          access_token: "private-access",
          refresh_token: "private-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        }),
    );
    expect(token).toBe("private-refresh");
  });
  it("Spotify remains authoritative about expired codes within a valid state window", async () => {
    const { session } = start();
    session.createdAt -= 11 * 60000;
    await expect(
      exchangeSpotifyCode(
        session,
        "private-secret",
        `${session.redirectUri}?code=expired-code&state=${session.state}`,
        async () => json({ error: "invalid_grant" }, 400),
      ),
    ).rejects.toMatchObject({ code: "AUTH_ERROR", details: { oauth_error: "invalid_grant" } });
  });
  it("sanitizes failed exchanges", async () => {
    const { session } = start();
    await expect(
      exchangeSpotifyCode(
        session,
        "private-secret",
        `${session.redirectUri}?code=private-code&state=${session.state}`,
        async () => json({ error: "invalid_grant", error_description: "PRIVATE_SECRET" }, 400),
      ),
    ).rejects.toMatchObject({ code: "AUTH_ERROR", details: { oauth_error: "invalid_grant" } });
  });
  it("requires an actual refresh token in the successful exchange", async () => {
    const { session } = start();
    await expect(
      exchangeSpotifyCode(
        session,
        "private-secret",
        `${session.redirectUri}?code=code&state=${session.state}`,
        async () => json({ access_token: "only-access", token_type: "Bearer" }),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("saving Spotify refresh preserves the Microsoft binding and replaces only its own token", () => {
    const before = 'MICROSOFT_ADS_REFRESH_TOKEN="private-ms"\nSPOTIFY_ADS_REFRESH_TOKEN="obsolete"\n';
    const after = updateEnvVariable(before, "SPOTIFY_ADS_REFRESH_TOKEN", "private-spotify");
    expect(after).toContain('MICROSOFT_ADS_REFRESH_TOKEN="private-ms"');
    expect(after).not.toContain("obsolete");
    expect(after.match(/SPOTIFY_ADS_REFRESH_TOKEN=/g)).toHaveLength(1);
  });
});
