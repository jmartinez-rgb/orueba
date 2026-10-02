import { setImmediate as nextTurn } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import type * as TokenStore from "../src/config/token-store.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeApp, KEY } from "./helpers.js";
import { MICROSOFT_ENV, microsoftSimulator } from "./microsoft-simulator.js";
import { SpotifySimulator } from "./spotify-simulator.js";

const saves = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../src/config/token-store.js", async (original) => ({
  ...(await original<typeof TokenStore>()),
  saveRotatedToken: saves.save,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const platforms = [
  {
    platform: "microsoft" as const,
    variable: "MICROSOFT_ADS_REFRESH_TOKEN",
    fixture() {
      const sim = microsoftSimulator();
      return {
        env: { ...MICROSOFT_ENV, MICROSOFT_ADS_TIMEOUT_MS: "1000" },
        request: sim.request,
        dataCount: () => sim.calls.filter((call) => call.url.hostname !== "login.microsoftonline.com").length,
      };
    },
  },
  {
    platform: "spotify" as const,
    variable: "SPOTIFY_ADS_REFRESH_TOKEN",
    fixture() {
      const sim = new SpotifySimulator();
      return {
        env: { ...sim.env, SPOTIFY_ADS_TIMEOUT_MS: "1000" },
        request: sim.fetch,
        dataCount: () => sim.calls.filter((call) => call.path !== "/api/token").length,
      };
    },
  },
];

let app: FastifyInstance | undefined;
beforeEach(() => {
  saves.save.mockReset();
});
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.unstubAllGlobals();
});

describe.each(platforms)("$platform app token-store lifecycle", ({ platform, variable, fixture }) => {
  it("waits for the app callback's storage promise before reporting connected", async () => {
    const sim = fixture();
    const gate = deferred();
    saves.save.mockReturnValue(gate.promise);
    vi.stubGlobal("fetch", sim.request);
    app = await makeApp({ providerEnv: sim.env, tokenStoreFile: "/private/test-token-store.env" });
    const info = vi.spyOn(app.log, "info");
    let completed = false;
    const response = app
      .inject({ url: `/api/v1/providers/${platform}/status`, headers: { "x-api-key": KEY } })
      .then((r) => {
        completed = true;
        return r;
      });
    try {
      await vi.waitFor(() => expect(saves.save).toHaveBeenCalledTimes(1));
      await nextTurn();
      expect(completed).toBe(false);
      expect(sim.dataCount()).toBe(0);
      expect(info).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
    }
    expect((await response).json().data.state).toBe("connected");
    expect(info).toHaveBeenCalledExactlyOnceWith({ variable }, "refresh token rotado guardado en TOKEN_STORE_FILE");
    expect(JSON.stringify(info.mock.calls)).not.toContain("rotated-refresh");
  });

  it.each(["async", "sync"] as const)(
    "reports %s failed persistence as PROVIDER_ERROR with a fixed log and no private error",
    async (kind) => {
      const sim = fixture();
      const failure = new Error("PRIVATE_STORAGE_FAILURE fixture-token /private/fixture-path");
      if (kind === "async") saves.save.mockRejectedValue(failure);
      else
        saves.save.mockImplementation(() => {
          throw failure;
        });
      vi.stubGlobal("fetch", sim.request);
      app = await makeApp({ providerEnv: sim.env, tokenStoreFile: "/private/test-token-store.env" });
      const error = vi.spyOn(app.log, "error");
      const response = await app.inject({ url: `/api/v1/providers/${platform}/status`, headers: { "x-api-key": KEY } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ state: "error", last_error: { code: "PROVIDER_ERROR" } });
      expect(response.body).not.toContain("AUTH_ERROR");
      expect(response.body).not.toContain("PRIVATE_STORAGE_FAILURE");
      expect(response.body).not.toContain("fixture-token");
      expect(error).toHaveBeenCalledExactlyOnceWith(
        { variable },
        "no se pudo guardar el refresh token rotado en TOKEN_STORE_FILE",
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain("PRIVATE_STORAGE_FAILURE");
      expect(sim.dataCount()).toBe(0);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "close drains a registered pending write after a request deadline, including %s",
    async (settle) => {
      const sim = fixture();
      const gate = deferred();
      saves.save.mockReturnValue(gate.promise);
      vi.stubGlobal("fetch", sim.request);
      app = await makeApp({
        providerEnv: sim.env,
        tokenStoreFile: "/private/test-token-store.env",
        providerTimeoutMs: 40,
      });
      const response = app.inject({ url: `/api/v1/providers/${platform}/status`, headers: { "x-api-key": KEY } });
      await vi.waitFor(() => expect(saves.save).toHaveBeenCalledTimes(1));
      expect((await response).json().data.last_error.code).toBe("PROVIDER_TIMEOUT");
      let closed = false;
      const closing = app.close().then(() => {
        closed = true;
      });
      try {
        await nextTurn();
        expect(closed).toBe(false);
        expect(sim.dataCount()).toBe(0);
      } finally {
        if (settle === "resolve") gate.resolve();
        else gate.reject(new Error("PRIVATE_STORAGE_FAILURE during-close"));
      }
      await closing;
      expect(closed).toBe(true);
      expect(saves.save).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the explicit no-store warning compatible, without inventing persistence", async () => {
    const sim = fixture();
    vi.stubGlobal("fetch", sim.request);
    app = await makeApp({ providerEnv: sim.env, tokenStoreFile: null });
    const warn = vi.spyOn(app.log, "warn");
    const response = await app.inject({ url: `/api/v1/providers/${platform}/status`, headers: { "x-api-key": KEY } });
    expect(response.json().data.state).toBe("connected");
    expect(saves.save).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ variable });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("rotated-refresh");
  });
});
