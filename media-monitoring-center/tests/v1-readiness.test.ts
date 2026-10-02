import { describe, expect, it } from "vitest";
import { v1Configuration, v1ProviderAccess } from "@/lib/release/readiness";
import type { ServerEnv } from "@/lib/config/env";
import type { AuthConfig } from "@/lib/auth/config";
import type { UnifiedProvider } from "@/lib/integrations/unified-api";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const env = {
  dataSource: "sheets",
  requestedDataSource: "sheets",
  unifiedApi: {
    configured: true,
    url: "https://example.test",
    apiKey: "synthetic-private-key",
    timeoutMs: 8000,
  },
} as Pick<
  ServerEnv,
  "dataSource" | "requestedDataSource" | "sheets" | "bigquery" | "unifiedApi"
>;
const auth = {
  mode: "password",
  accounts: [
    {
      username: "synthetic-user",
      name: "Private name",
      hash: "private-password-hash",
      role: "admin",
    },
  ],
  issues: [],
} as Pick<AuthConfig, "mode" | "accounts" | "issues">;

describe("preparación de configuración de v1", () => {
  it("una fuente real, cuentas nominales, registros persistentes y API configurada completan configuración, no certifican datos", () => {
    const report = v1Configuration(env, auth, "netlify-blobs");
    expect(report.configurationReady).toBe(true);
    expect(report).not.toHaveProperty("releaseReady");
    expect(report).not.toHaveProperty("metricsVerified");
  });
  it("la caída de una fuente solicitada a mock sigue pendiente, aunque la aplicación pueda responder health", () => {
    const report = v1Configuration(
      { ...env, dataSource: "mock" },
      auth,
      "file",
    );
    expect(report.configurationReady).toBe(false);
    expect(report.checks.find((c) => c.id === "data")).toMatchObject({
      status: "pending",
      code: "SOURCE_CONFIGURATION_MISSING",
    });
  });
  it.each(["open", "locked", "header"] as const)(
    "el modo %s no se presenta como acceso nominal ya verificado",
    (mode) => {
      expect(
        v1Configuration(env, { ...auth, mode }, "netlify-blobs")
          .configurationReady,
      ).toBe(false);
    },
  );
  it("configuración de usuarios inválida o sin cuentas no satisface el acceso", () => {
    expect(
      v1Configuration(env, { ...auth, accounts: [] }, "file")
        .configurationReady,
    ).toBe(false);
    expect(
      v1Configuration(
        env,
        { ...auth, issues: ["private-configuration-issue"] },
        "file",
      ).configurationReady,
    ).toBe(false);
  });
  it("memoria señala registros volátiles; no se confunde con persistencia tras reiniciar", () => {
    expect(
      v1Configuration(env, auth, "memory").checks.find(
        (c) => c.id === "records",
      ),
    ).toMatchObject({ status: "pending", code: "VOLATILE_RECORDS" });
  });
  it("no expone URL, llave interna, usuarios, hashes o mensajes de configuración", () => {
    const text = JSON.stringify(
      v1Configuration(
        env,
        { ...auth, issues: ["private-configuration-issue"] },
        "file",
      ),
    );
    for (const value of [
      "synthetic-private-key",
      "https://example.test",
      "synthetic-user",
      "Private name",
      "private-password-hash",
      "private-configuration-issue",
    ])
      expect(text).not.toContain(value);
  });
  it("sin API conserva la lista de nombres requeridos sin inventar conexión", () => {
    const report = v1Configuration(
      { ...env, unifiedApi: { ...env.unifiedApi, configured: false } },
      auth,
      "file",
    );
    expect(report.configurationReady).toBe(false);
    expect(
      report.checks.find((c) => c.id === "unified_api")?.variables,
    ).toEqual(["UNIFIED_ADS_API_URL", "UNIFIED_ADS_API_KEY"]);
  });
});

describe("acceso a las seis plataformas para v1", () => {
  const providers = [
    "google",
    "meta",
    "tiktok",
    "microsoft",
    "spotify",
    "x",
  ].map((id) => ({
    id,
    name: "private-source-name",
    implemented: true,
    status: { state: "connected", configured: true, last_error: null },
  })) as UnifiedProvider[];
  it("requiere las seis plataformas conectadas, sin certificar métricas", () => {
    expect(v1ProviderAccess(providers).available).toBe(true);
    expect(v1ProviderAccess(providers.slice(0, 1)).available).toBe(false);
    expect(v1ProviderAccess([]).providers).toHaveLength(6);
    expect(
      v1ProviderAccess([]).providers.every(
        (p) => p.code === "MISSING_PROVIDER",
      ),
    ).toBe(true);
  });
  it("IDs duplicados o inesperados no pueden ocultar una plataforma ausente", () => {
    expect(
      v1ProviderAccess([...providers.slice(0, -1), providers[0]]).available,
    ).toBe(false);
    expect(
      v1ProviderAccess([
        ...providers,
        { ...providers[0], id: "private-unknown-id" },
      ]).available,
    ).toBe(false);
  });
  it("un estado de conexión no sustituye implementación y configuración", () => {
    expect(
      v1ProviderAccess([
        { ...providers[0], implemented: false },
        ...providers.slice(1),
      ]).available,
    ).toBe(false);
    expect(
      v1ProviderAccess([
        {
          ...providers[0],
          status: { ...providers[0].status, configured: false },
        },
        ...providers.slice(1),
      ]).available,
    ).toBe(false);
  });
  it("la denegación de una plataforma impide completar acceso y solo muestra códigos válidos", () => {
    const denied = {
      ...providers[0],
      status: {
        ...providers[0].status,
        state: "permission_denied" as const,
        last_error: {
          code: "ACCESS_DENIED",
          message: "private-source-message",
          at: "private-time",
        },
      },
    };
    const report = v1ProviderAccess([denied, ...providers.slice(1)]);
    expect(report.available).toBe(false);
    expect(report.providers[0].code).toBe("ACCESS_DENIED");
    expect(JSON.stringify(report)).not.toContain("private");
    expect(
      v1ProviderAccess([
        {
          ...denied,
          status: {
            ...denied.status,
            last_error: { ...denied.status.last_error, code: "private-marker" },
          },
        },
        ...providers.slice(1),
      ]).providers[0].code,
    ).toBeNull();
  });
});

it("el comando carga el entorno de producción, conserva fallos como pendientes y no imprime valores privados", async () => {
  const root = resolve(import.meta.dirname, "..");
  const directory = await mkdtemp(join(tmpdir(), "monitoring-v1-"));
  try {
    await writeFile(
      join(directory, ".env.production"),
      "DATA_SOURCE=sheets\nSHEETS_SPREADSHEET_ID=synthetic-private-sheet\nGOOGLE_CLIENT_EMAIL=synthetic-private-email\nGOOGLE_PRIVATE_KEY=synthetic-private-key\n",
    );
    await writeFile(join(directory, ".env.development"), "DATA_SOURCE=mock\n");
    const loader = pathToFileURL(
      createRequire(import.meta.url).resolve("tsx"),
    ).href;
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((done) => {
      execFile(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          loader,
          join(root, "scripts/v1-check.ts"),
          "--sin-red",
        ],
        {
          cwd: directory,
          timeout: 10000,
          encoding: "utf8",
          env: {
            NODE_ENV: "development",
            PATH: process.env.PATH,
            TSX_TSCONFIG_PATH: join(root, "tsconfig.json"),
            AUTH_MODE: "password",
            AUTH_SECRET: "synthetic-private-session-secret-32",
            AUTH_USERS: JSON.stringify([
              {
                username: "synthetic/private-user",
                hash: "synthetic-private-hash",
                role: "admin",
              },
            ]),
            RECORDS_BACKEND: "memory",
          },
        },
        (error, stdout, stderr) =>
          done({
            code: error
              ? typeof error.code === "number"
                ? error.code
                : null
              : 0,
            stdout,
            stderr,
          }),
      );
    });
    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout.split("\n")[0]);
    expect(
      report.checks.find((c: { id: string }) => c.id === "data").code,
    ).toBe("REAL_SOURCE_CONFIGURED");
    expect(report.configurationReady).toBe(false);
    expect(report.providerAccess.checked).toBe(false);
    expect(result.stdout + result.stderr).not.toContain("synthetic-private");
    expect(result.stdout + result.stderr).not.toContain(
      "synthetic/private-user",
    );
    expect(result.stderr).toBe("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
