import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/env.js";
import { hashApiKey, isValidApiKey, parseApiKeys } from "../src/utils/api-keys.js";

const KEY = "llave-interna-0123456789abcdef";

describe("configuración", () => {
  it("valores por omisión y listas separadas por coma", () => {
    const c = loadConfig({ API_KEYS: KEY, CORS_ORIGINS: "https://a.netlify.app, https://b.app" });
    expect(c.port).toBe(8080);
    expect(c.env).toBe("development");
    expect(c.corsOrigins).toEqual(["https://a.netlify.app", "https://b.app"]);
    expect(c.docsEnabled).toBe(true);
    expect(c.apiKeyHashes).toHaveLength(1);
  });

  it("exige al menos una llave fuera de pruebas", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: "test" })).not.toThrow();
  });

  it("rechaza llaves cortas y huellas mal formadas", () => {
    expect(() => loadConfig({ API_KEYS: "corta" })).toThrow(/al menos 24/);
    expect(() => loadConfig({ API_KEYS: "sha256:abc" })).toThrow(/64 caracteres/);
  });

  it("valida puerto y booleanos", () => {
    expect(() => loadConfig({ API_KEYS: KEY, PORT: "99999" })).toThrow(ConfigError);
    expect(loadConfig({ API_KEYS: KEY, DOCS_ENABLED: "false", TRUST_PROXY: "1" })).toMatchObject({
      docsEnabled: false,
      trustProxy: true,
    });
  });

  it("guarda solo variables de proveedores, nunca otras", () => {
    const c = loadConfig({ API_KEYS: KEY, META_ACCESS_TOKEN: "x", HOME: "/root" });
    expect(c.providerEnv).toEqual({ META_ACCESS_TOKEN: "x" });
  });
});

describe("llaves", () => {
  it("compara contra las huellas en tiempo constante", () => {
    const { hashes, errors } = parseApiKeys(
      `${KEY}, sha256:${hashApiKey("otra-llave-abcdefghijklmnopqr").toString("hex")}`,
    );
    expect(errors).toEqual([]);
    expect(isValidApiKey(KEY, hashes)).toBe(true);
    expect(isValidApiKey("otra-llave-abcdefghijklmnopqr", hashes)).toBe(true);
    expect(isValidApiKey("nope", hashes)).toBe(false);
    expect(isValidApiKey(undefined, hashes)).toBe(false);
  });
});
