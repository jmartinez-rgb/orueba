import pg from "pg";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "../src/config/env.js";
import { prepareEnvAsync } from "../src/config/load-env.js";
import {
  closeTokenStorePools,
  readPostgresTokenStore,
  savePostgresRotatedToken,
} from "../src/config/token-store-postgres.js";
import { makeApp, KEY } from "./helpers.js";
import { MICROSOFT_ENV, microsoftSimulator } from "./microsoft-simulator.js";

const KEYS = "test-key-0123456789abcdefghij";

describe("TOKEN_STORE=postgres configuration", () => {
  it("requires DATABASE_URL and refuses a second store", () => {
    expect(() => loadConfig({ API_KEYS: KEYS, TOKEN_STORE: "postgres" })).toThrow(ConfigError);
    expect(() =>
      loadConfig({
        API_KEYS: KEYS,
        TOKEN_STORE: "postgres",
        DATABASE_URL: "postgres://db/x",
        TOKEN_STORE_FILE: "/var/data/t.env",
      }),
    ).toThrow(/no se combina/);
    expect(() => loadConfig({ API_KEYS: KEYS, TOKEN_STORE: "s3" })).toThrow(/file o postgres/);
    const config = loadConfig({ API_KEYS: KEYS, TOKEN_STORE: "postgres", DATABASE_URL: "postgres://db/x" });
    expect(config).toMatchObject({ tokenStoreDatabaseUrl: "postgres://db/x", tokenStoreFile: null });
    expect(loadConfig({ API_KEYS: KEYS, DATABASE_URL: "postgres://db/x" }).tokenStoreDatabaseUrl).toBeNull();
  });

  it("stops startup when the database cannot be read, without exposing the cause", async () => {
    const env: NodeJS.ProcessEnv = { TOKEN_STORE: "postgres", DATABASE_URL: "postgres://user:secret@127.0.0.1:1/none" };
    const error = await prepareEnvAsync(env, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect(String((error as Error).message)).not.toContain("secret");
    await closeTokenStorePools();
  });
});

/** Needs TEST_DATABASE_URL (a disposable database); without it the suite is reported as skipped. */
const url = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!url)("rotated tokens in PostgreSQL", () => {
  let admin: pg.Pool;
  let app: FastifyInstance | undefined;
  beforeAll(() => {
    admin = new pg.Pool({ connectionString: url });
  });
  beforeEach(async () => {
    await readPostgresTokenStore(url!);
    await admin.query("TRUNCATE api_rotated_tokens");
  });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await admin.end();
    await closeTokenStorePools();
  });

  it("the stored token wins over the panel value at startup; unknown names are ignored", async () => {
    await savePostgresRotatedToken(url!, "MICROSOFT_ADS_REFRESH_TOKEN", "rotated-2");
    await savePostgresRotatedToken(url!, "MICROSOFT_ADS_REFRESH_TOKEN", "rotated-3");
    await admin.query("INSERT INTO api_rotated_tokens (name, value) VALUES ('OTHER_SECRET', 'x')");
    const env: NodeJS.ProcessEnv = {
      TOKEN_STORE: "postgres",
      DATABASE_URL: url,
      MICROSOFT_ADS_REFRESH_TOKEN: "panel-1",
    };
    expect(await prepareEnvAsync(env, {})).toEqual({ fromStore: ["MICROSOFT_ADS_REFRESH_TOKEN"] });
    expect(env.MICROSOFT_ADS_REFRESH_TOKEN).toBe("rotated-3");
    expect(env.OTHER_SECRET).toBeUndefined();
  });

  it("rejects an empty or multi-line token without writing", async () => {
    await expect(savePostgresRotatedToken(url!, "SPOTIFY_ADS_REFRESH_TOKEN", "a\nb")).rejects.toThrow();
    expect((await admin.query("SELECT count(*)::int AS n FROM api_rotated_tokens")).rows[0].n).toBe(0);
  });

  it("a rotation during a provider call is persisted in PostgreSQL before reporting connected", async () => {
    const sim = microsoftSimulator();
    vi.stubGlobal("fetch", sim.request);
    app = await makeApp({
      providerEnv: { ...MICROSOFT_ENV, MICROSOFT_ADS_TIMEOUT_MS: "1000" },
      tokenStoreDatabaseUrl: url!,
    });
    const response = await app.inject({ url: "/api/v1/providers/microsoft/status", headers: { "x-api-key": KEY } });
    expect(response.json().data.state).toBe("connected");
    const { rows } = await admin.query("SELECT name, value FROM api_rotated_tokens");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("MICROSOFT_ADS_REFRESH_TOKEN");
    expect(rows[0].value).not.toBe(MICROSOFT_ENV.MICROSOFT_ADS_REFRESH_TOKEN);
  });
});
