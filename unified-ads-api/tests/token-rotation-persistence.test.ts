import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { MicrosoftClient } from "../src/providers/microsoft/client.js";
import { readMicrosoftConfig } from "../src/providers/microsoft/config.js";
import { MicrosoftProvider } from "../src/providers/microsoft/index.js";
import { SpotifyClient } from "../src/providers/spotify/client.js";
import { readSpotifyConfig } from "../src/providers/spotify/config.js";
import { SpotifyProvider } from "../src/providers/spotify/index.js";
import { ApiError, errorBody } from "../src/utils/errors.js";
import { MICROSOFT_ENV, microsoftSimulator } from "./microsoft-simulator.js";
import { ACCOUNT, SpotifySimulator } from "./spotify-simulator.js";

type Persistence = (token: string) => unknown;
interface RotationFixture {
  rotated: string;
  clientRequest: () => Promise<unknown>;
  providerRequest: () => Promise<unknown>;
  oauthCount: () => number;
  dataCount: () => number;
}
interface PlatformFixture {
  platform: "microsoft" | "spotify";
  create: (persist: Persistence, retries?: number) => RotationFixture;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // The old implementation ignores the callback promise. Keep the reproduction local:
  // the original promise still rejects for an awaited consumer, without an unhandled rejection.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

const platforms: PlatformFixture[] = [
  {
    platform: "microsoft",
    create(persist, retries = 0) {
      const sim = microsoftSimulator();
      const env = {
        ...MICROSOFT_ENV,
        MICROSOFT_ADS_ACCOUNT_IDS: "101",
        MICROSOFT_ADS_RETRIES: String(retries),
      };
      const retry = { sleep: async () => undefined, random: () => 0 };
      const client = new MicrosoftClient(readMicrosoftConfig(env).config!, sim.request, retry, persist);
      const provider = new MicrosoftProvider(env, {
        fetch: sim.request,
        retry,
        onRefreshTokenRotated: persist,
      });
      return {
        rotated: "fake-rotated-refresh",
        clientRequest: () => client.call("user", {}, AbortSignal.timeout(2000)),
        providerRequest: () => provider.listAccounts({}),
        oauthCount: () => sim.calls.filter((call) => call.url.hostname === "login.microsoftonline.com").length,
        dataCount: () => sim.calls.filter((call) => call.url.hostname !== "login.microsoftonline.com").length,
      };
    },
  },
  {
    platform: "spotify",
    create(persist, retries = 0) {
      const sim = new SpotifySimulator();
      const env = { ...sim.env, SPOTIFY_ADS_ACCOUNT_IDS: ACCOUNT, SPOTIFY_ADS_RETRIES: String(retries) };
      const retry = { sleep: async () => undefined, random: () => 0 };
      const client = new SpotifyClient(readSpotifyConfig(env).config!, sim.fetch, retry, persist);
      const provider = new SpotifyProvider(env, {
        fetch: sim.fetch,
        retry,
        onRefreshTokenRotated: persist,
      });
      return {
        rotated: "synthetic-rotated-refresh",
        clientRequest: () => client.get("/businesses", new URLSearchParams(), AbortSignal.timeout(2000)),
        providerRequest: () => provider.listAccounts({}),
        oauthCount: () => sim.calls.filter((call) => call.path === "/api/token").length,
        dataCount: () => sim.calls.filter((call) => call.path !== "/api/token").length,
      };
    },
  },
];

function persistenceFailure(error: unknown, platform: string) {
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    code: "PROVIDER_ERROR",
    details: { provider: platform, limitation: "token_persistence_failed" },
  });
  const safe = error as ApiError;
  expect(safe.code).not.toBe("AUTH_ERROR");
  expect(safe.cause).toBeUndefined();
  expect(`${String(safe)} ${JSON.stringify(errorBody(safe, "fixture-request"))}`).not.toContain("PRIVATE_FAILURE");
}

describe.each(platforms)("$platform refresh-token persistence", ({ platform, create }) => {
  it("does not issue an API operation until asynchronous persistence finishes", async () => {
    const gate = deferred();
    const persist = vi.fn(() => gate.promise);
    const fixture = create(persist);
    let settled = false;
    const pending = fixture.clientRequest().finally(() => {
      settled = true;
    });
    try {
      await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
      await nextTurn();
      expect(fixture.oauthCount()).toBe(1);
      expect(fixture.dataCount()).toBe(0);
      expect(settled).toBe(false);
      expect(persist).toHaveBeenCalledWith(fixture.rotated);
    } finally {
      gate.resolve();
      await pending;
    }
    expect(fixture.dataCount()).toBe(1);
  });

  it("shares one OAuth renewal and one asynchronous persistence among concurrent requests", async () => {
    const gate = deferred();
    const persist = vi.fn(() => gate.promise);
    const fixture = create(persist);
    const pending = Array.from({ length: 6 }, () => fixture.clientRequest());
    try {
      await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
      await nextTurn();
      expect(fixture.oauthCount()).toBe(1);
      expect(fixture.dataCount()).toBe(0);
    } finally {
      gate.resolve();
      await Promise.all(pending);
    }
    expect(fixture.oauthCount()).toBe(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(fixture.dataCount()).toBe(6);
  });

  it.each(["clientRequest", "providerRequest"] as const)(
    "reports an asynchronous persistence rejection safely through %s",
    async (operation) => {
      const gate = deferred();
      const persist = vi.fn(() => gate.promise);
      const fixture = create(persist, 3);
      const pending = fixture[operation]();
      const result = Promise.allSettled([pending]);
      await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
      gate.reject(new Error("PRIVATE_FAILURE private-path private-token"));
      const [outcome] = await result;
      expect(outcome?.status).toBe("rejected");
      if (outcome?.status === "rejected") persistenceFailure(outcome.reason, platform);
      expect(fixture.oauthCount()).toBe(1);
      expect(fixture.dataCount()).toBe(0);
      expect(persist).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["clientRequest", "providerRequest"] as const)(
    "reports a synchronous persistence failure safely through %s",
    async (operation) => {
      const persist = vi.fn(() => {
        throw new Error("PRIVATE_FAILURE private-path private-token");
      });
      const fixture = create(persist, 3);
      const [outcome] = await Promise.allSettled([fixture[operation]()]);
      expect(outcome?.status).toBe("rejected");
      if (outcome?.status === "rejected") persistenceFailure(outcome.reason, platform);
      expect(fixture.oauthCount()).toBe(1);
      expect(fixture.dataCount()).toBe(0);
      expect(persist).toHaveBeenCalledTimes(1);
    },
  );

  it("retries the same pending token before cached access, without a second OAuth renewal", async () => {
    const first = deferred();
    const second = deferred();
    const persist = vi.fn(() => (persist.mock.calls.length === 1 ? first.promise : second.promise));
    const fixture = create(persist);
    const failed = Promise.allSettled(Array.from({ length: 3 }, () => fixture.clientRequest()));
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    first.reject(new Error("PRIVATE_FAILURE first-write"));
    const outcomes = await failed;
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") persistenceFailure(outcome.reason, platform);
    }
    expect(fixture.dataCount()).toBe(0);

    const retrying = Array.from({ length: 3 }, () => fixture.clientRequest());
    try {
      await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
      await nextTurn();
      expect(persist.mock.calls).toEqual([[fixture.rotated], [fixture.rotated]]);
      expect(fixture.oauthCount()).toBe(1);
      expect(fixture.dataCount()).toBe(0);
    } finally {
      second.resolve();
      await Promise.all(retrying);
    }
    expect(fixture.dataCount()).toBe(3);
    await fixture.clientRequest();
    expect(fixture.oauthCount()).toBe(1);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(fixture.dataCount()).toBe(4);
  });

  it.each(["clientRequest", "providerRequest"] as const)(
    "preserves synchronous callbacks with arbitrary return values through %s",
    async (operation) => {
      const persist = vi.fn(() => ({ saved: true }));
      const fixture = create(persist);
      await fixture[operation]();
      expect(persist).toHaveBeenCalledExactlyOnceWith(fixture.rotated);
      expect(fixture.oauthCount()).toBe(1);
      expect(fixture.dataCount()).toBe(1);
    },
  );
});
