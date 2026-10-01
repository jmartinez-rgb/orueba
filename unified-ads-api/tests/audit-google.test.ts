import { describe, expect, it } from "vitest";
import { GoogleProvider } from "../src/providers/google/index.js";
import { googleError } from "../src/providers/google/errors.js";
import type { ApiError } from "../src/utils/errors.js";
import { GOOGLE_ENV, GoogleSimulator, failure, type GoogleCall } from "./google-simulator.js";

// Auditoría Google: MCC sin login-customer-id configurado, cuentas no habilitadas o sin permiso
// dentro de una jerarquía grande y el tiempo de espera que Google indica en errores de cuota.
const day = { date_from: "2026-09-01", date_to: "2026-09-01", granularity: "daily" as const };
const isSearch = (call: GoogleCall, id: string) => call.url.pathname.endsWith(`/customers/${id}/googleAds:search`);
const campaignSearch = (call: GoogleCall, id: string) =>
  isSearch(call, id) && String(call.body.query).includes(" FROM campaign");

function clientsWith(simulator: GoogleSimulator, status: Record<string, string>) {
  const previous = simulator.intercept;
  simulator.intercept = (call) => {
    const query = String(call.body.query ?? "");
    if (query.includes(" FROM customer_client "))
      return Response.json({
        results: ["2222222222", "3333333333"].map((id, i) => ({
          customerClient: {
            id,
            descriptiveName: `Account ${id}`,
            currencyCode: "MXN",
            timeZone: "America/Mexico_City",
            manager: false,
            status: status[id] ?? "ENABLED",
            level: String(i + 1),
          },
        })),
      });
    return previous?.(call);
  };
}

describe("auditoría Google: cuenta cliente de MCC sin login-customer-id configurado", () => {
  it("consulta una cuenta cliente usando la MCC accesible que la contiene", async () => {
    const simulator = new GoogleSimulator();
    const env = { ...GOOGLE_ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined };
    // Google exige login-customer-id de la MCC para operar una cuenta cliente.
    simulator.intercept = (call) =>
      isSearch(call, "2222222222") && call.headers.get("login-customer-id") !== "1111111111"
        ? Response.json(failure("authorizationError", "USER_PERMISSION_DENIED"), { status: 403 })
        : undefined;
    const provider = new GoogleProvider(env, { fetch: simulator.fetch, retry: { retries: 0 } });
    const rows = await provider.getPerformance({ ...day, account_id: "2222222222" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.account_id === "2222222222")).toBe(true);
  });
});

describe("auditoría Google: jerarquías grandes", () => {
  it("no consulta métricas de cuentas canceladas o suspendidas", async () => {
    const simulator = new GoogleSimulator();
    clientsWith(simulator, { "3333333333": "CANCELED" });
    const provider = new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } });
    const rows = await provider.getPerformance(day);
    expect(rows.map((r) => r.account_id)).toEqual(["2222222222"]);
    expect(simulator.calls.some((c) => campaignSearch(c, "3333333333"))).toBe(false);
    // Siguen visibles en la lista de cuentas con su estado.
    const accounts = await provider.listAccounts({});
    expect(accounts.find((a) => a.account_id === "3333333333")?.status).toBe("CANCELED");
  });

  it("una cuenta sin permiso no tumba a las demás: queda como advertencia", async () => {
    const simulator = new GoogleSimulator();
    clientsWith(simulator, {});
    const base = simulator.intercept!;
    simulator.intercept = (call) =>
      campaignSearch(call, "3333333333")
        ? Response.json(failure("authorizationError", "USER_PERMISSION_DENIED"), { status: 403 })
        : base(call);
    const provider = new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } });
    const warnings: ApiError[] = [];
    const rows = await provider.getPerformance(day, { onWarning: (w) => warnings.push(w) });
    expect(rows.map((r) => r.account_id)).toEqual(["2222222222"]);
    expect(warnings.map((w) => w.details)).toContainEqual(expect.objectContaining({ account_id: "3333333333" }));
  });

  it("si se pide esa cuenta en específico, el error sí se devuelve", async () => {
    const simulator = new GoogleSimulator();
    simulator.intercept = (call) =>
      campaignSearch(call, "3333333333")
        ? Response.json(failure("authorizationError", "USER_PERMISSION_DENIED"), { status: 403 })
        : undefined;
    const provider = new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } });
    await expect(provider.getPerformance({ ...day, account_id: "3333333333" })).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });
  });

  it("si ninguna cuenta responde por permisos, el error es global", async () => {
    const simulator = new GoogleSimulator();
    clientsWith(simulator, {});
    const base = simulator.intercept!;
    simulator.intercept = (call) =>
      String(call.body.query ?? "").includes(" FROM campaign")
        ? Response.json(failure("authorizationError", "USER_PERMISSION_DENIED"), { status: 403 })
        : base(call);
    const provider = new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } });
    await expect(provider.getPerformance(day)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});

describe("auditoría Google: cuota y estado", () => {
  it("toma el retryDelay de QuotaErrorDetails cuando Google no manda Retry-After", () => {
    const body = {
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
            errors: [
              {
                errorCode: { quotaError: "RESOURCE_TEMPORARILY_EXHAUSTED" },
                details: { quotaErrorDetails: { retryDelay: "7s", rateScope: "ACCOUNT" } },
              },
            ],
          },
        ],
      },
    };
    expect(googleError(429, body)).toMatchObject({ code: "RATE_LIMITED", retryAfter: 7 });
  });

  it("un refresh token rechazado se reporta como error de autenticación, no como falta de permisos", async () => {
    const simulator = new GoogleSimulator();
    simulator.intercept = (call) =>
      call.url.hostname === "oauth2.googleapis.com"
        ? Response.json(
            { error: "invalid_grant", error_description: "Token has been expired or revoked." },
            { status: 400 },
          )
        : undefined;
    const provider = new GoogleProvider(GOOGLE_ENV, { fetch: simulator.fetch, retry: { retries: 0 } });
    expect(await provider.status()).toMatchObject({ state: "error", last_error: { code: "AUTH_ERROR" } });
  });
});
