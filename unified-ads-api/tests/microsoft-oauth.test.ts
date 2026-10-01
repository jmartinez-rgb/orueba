import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createMicrosoftOAuthRequest,
  microsoftAuthorizationCode,
  exchangeMicrosoftCode,
} from "../src/providers/microsoft/oauth.js";
import { MICROSOFT_ENV, json } from "./microsoft-simulator.js";
import type { MicrosoftFetch } from "../src/providers/microsoft/client.js";

const start = () => createMicrosoftOAuthRequest(MICROSOFT_ENV.MICROSOFT_ADS_CLIENT_ID);
describe("Microsoft browser-only OAuth", () => {
  it("uses the official endpoint, offline scope, consent, and unique PKCE/state", () => {
    const { session, url } = start(),
      u = new URL(url),
      second = start();
    expect(u.origin).toBe("https://login.microsoftonline.com");
    expect(u.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toBe("https://ads.microsoft.com/msads.manage offline_access");
    expect(u.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(session.verifier).digest("base64url"),
    );
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(session.state).not.toBe(second.session.state);
    expect(session.verifier).not.toBe(second.session.verifier);
    expect(url).not.toContain(session.verifier);
    expect(url).not.toContain("fake-client-secret");
  });
  it.each([
    "https://attacker.test/callback",
    "http://localhost:8089/oauth?code=x",
    "http://user:secret@localhost:8089/oauth",
  ])("rejects an unsupported callback registration %s", (uri) => {
    expect(() => createMicrosoftOAuthRequest(MICROSOFT_ENV.MICROSOFT_ADS_CLIENT_ID, uri)).toThrow();
  });
  it("extracts a percent-encoded code from the exact callback, matching state", () => {
    const { session } = start();
    expect(microsoftAuthorizationCode(`${session.redirectUri}?code=abc%2B123&state=${session.state}`, session)).toBe(
      "abc+123",
    );
  });
  it.each(["missing-state", "wrong-state", "duplicate-code", "wrong-path", "cancelled", "expired"])(
    "rejects %s",
    (failure) => {
      const { session } = start();
      const url = new URL(session.redirectUri);
      url.search = new URLSearchParams({ code: "private-code", state: session.state }).toString();
      if (failure === "missing-state") url.searchParams.delete("state");
      if (failure === "wrong-state") url.searchParams.set("state", "wrong");
      if (failure === "duplicate-code") url.searchParams.append("code", "second");
      if (failure === "wrong-path") url.pathname = "/wrong";
      if (failure === "cancelled") url.searchParams.set("error", "access_denied");
      if (failure === "expired") session.createdAt -= 21 * 60000;
      expect(() => microsoftAuthorizationCode(url.toString(), session)).toThrow();
    },
  );
  it("exchanges with the same redirect, verifier and confidential client secret", async () => {
    const { session } = start();
    const request: MicrosoftFetch = async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_secret")).toBe("private-secret");
      expect(body.get("code_verifier")).toBe(session.verifier);
      expect(body.get("redirect_uri")).toBe(session.redirectUri);
      expect(init?.redirect).toBe("error");
      return json({ refresh_token: "private-refresh" });
    };
    expect(
      await exchangeMicrosoftCode(
        session,
        "private-secret",
        `${session.redirectUri}?code=private-code&state=${session.state}`,
        request,
      ),
    ).toBe("private-refresh");
  });
  it("sanitizes a rejected exchange and never repeats the raw response", async () => {
    const { session } = start();
    const request: MicrosoftFetch = async () =>
      json({ error: "invalid_grant", error_description: "PRIVATE_SECRET" }, 400);
    await expect(
      exchangeMicrosoftCode(session, "secret", `${session.redirectUri}?code=code&state=${session.state}`, request),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
  });
});
