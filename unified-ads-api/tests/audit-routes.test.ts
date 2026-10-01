import { describe, expect, it } from "vitest";
import { BaseProvider } from "../src/providers/base-provider.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { readMicrosoftConfig } from "../src/providers/microsoft/config.js";
import { Provider } from "../src/types/providers.js";
import type { NormalizedAccount } from "../src/types/normalized.js";
import { KEY, makeApp } from "./helpers.js";
import { MICROSOFT_ENV } from "./microsoft-simulator.js";

const auth = { "x-api-key": KEY };
const account: NormalizedAccount = {
  platform: "microsoft",
  client_id: null,
  account_id: "1",
  account_name: "Cuenta",
  currency: "MXN",
  timezone: null,
  status: "Active",
  manager_account_id: null,
};

/** Integración lenta (como un informe asíncrono) con su propio límite de tiempo. */
class SlowProvider extends BaseProvider {
  override readonly implemented = true;
  constructor(readonly timeoutMs: number) {
    super(Provider.MICROSOFT, [], {});
  }
  override async listAccounts() {
    await new Promise((r) => setTimeout(r, 1500));
    return [account];
  }
}

describe("auditoría rutas: límites de tiempo por proveedor", () => {
  it("respeta el límite propio del proveedor aunque supere PROVIDER_TIMEOUT_MS", async () => {
    const app = await makeApp(
      { providerTimeoutMs: 1000 },
      { registry: new ProviderRegistry([new SlowProvider(5000)]) },
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/accounts?provider=microsoft", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    await app.close();
  });

  it("Microsoft usa 120 s por omisión para generar y descargar informes", () => {
    expect(readMicrosoftConfig(MICROSOFT_ENV, 15000).config?.timeoutMs).toBe(120000);
    expect(readMicrosoftConfig({ ...MICROSOFT_ENV, MICROSOFT_ADS_TIMEOUT_MS: "30000" }, 15000).config?.timeoutMs).toBe(
      30000,
    );
  });
});

describe("auditoría rutas: consulta de todos los proveedores", () => {
  it("sin proveedor explícito no reporta como error a las integraciones no configuradas", async () => {
    const app = await makeApp(); // ningún proveedor configurado
    const res = await app.inject({ method: "GET", url: "/api/v1/accounts", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], errors: [] });
    await app.close();
  });
});
