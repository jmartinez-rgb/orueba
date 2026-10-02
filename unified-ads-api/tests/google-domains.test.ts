import { describe, expect, it } from "vitest";
import {
  GOOGLE_ADS_DOMAIN_CONFIG,
  googleDomainConfigSchema,
  googleDomainMetadata,
  normalizeGoogleCustomerId,
  withGoogleDomain,
} from "../src/config/google-domains.js";
import { KEY, makeApp } from "./helpers.js";

describe("dimensión maestra Google: identidades explícitas, sin heurísticas", () => {
  it.each([
    ["8779536058", "first_domain", "Primer Dominio", 0.7],
    ["877-953-6058", "first_domain", "Primer Dominio", 0.7],
    ["6214109105", "first_domain", "Primer Dominio", 0.7],
    ["621-410-9105", "first_domain", "Primer Dominio", 0.7],
    ["3224850043", "second_domain", "Segundo Dominio", 0.1],
    ["322-485-0043", "second_domain", "Segundo Dominio", 0.1],
    ["7367928294", "third_domain", "Tercer Dominio", 0.25],
    ["736-792-8294", "third_domain", "Tercer Dominio", 0.25],
  ])("clasifica %s sin depender de su nombre", (id, domain, name, minimum) => {
    expect(googleDomainMetadata(String(id), "Nombre renombrado por la plataforma")).toMatchObject({
      domain_id: domain,
      domain_name: name,
      customer_id: String(id).replaceAll("-", ""),
      account_name: "Nombre renombrado por la plataforma",
      absolute_top_minimum: minimum,
      domain_warning: null,
    });
  });

  it("una cuenta ajena no hereda dominio por llamarse Performance AO", () => {
    expect(googleDomainMetadata("0000000001", "izzi – Performance AO - mxn")).toMatchObject({
      domain_id: "unclassified",
      domain_name: "Unclassified",
      absolute_top_minimum: null,
      domain_warning: "GOOGLE_DOMAIN_UNCLASSIFIED",
    });
  });

  it.each(["877.953.6058", "877 953 6058", "877--9536058", "87795360580", "8.779536058e9", "abc8779536058", ""])(
    "no normaliza una identidad ambigua %s",
    (id) => expect(normalizeGoogleCustomerId(id)).toBeNull(),
  );

  it("conserva la identidad desconocida y los nulos, sin fabricar nombres", () => {
    expect(googleDomainMetadata("bad-id")).toMatchObject({ customer_id: "bad-id", account_name: null });
    expect(googleDomainMetadata("8779536058").account_name).toBe("izzi – Performance AO - mxn");
  });

  it("enriquece un registro sin modificar su entrada ni tocar sus métricas", () => {
    const before = { account_id: "3224850043", campaign_id: "1", spend: null, conversions: 0 };
    const actual = withGoogleDomain(before);
    expect(before).toEqual({ account_id: "3224850043", campaign_id: "1", spend: null, conversions: 0 });
    expect(actual).toMatchObject({
      domain_id: "second_domain",
      customer_id: "3224850043",
      spend: null,
      conversions: 0,
    });
  });

  it("rechaza un Customer ID asignado a dos dominios", () => {
    const duplicate = structuredClone(GOOGLE_ADS_DOMAIN_CONFIG);
    duplicate.domains[1]!.accounts.push({ ...duplicate.domains[0]!.accounts[0]! });
    expect(googleDomainConfigSchema.safeParse(duplicate).success).toBe(false);
  });

  it("admite ampliar la configuración sin cambiar el clasificador", () => {
    const changed = structuredClone(GOOGLE_ADS_DOMAIN_CONFIG);
    changed.domains.push({
      id: "fourth_domain",
      name: "Cuarto Dominio",
      accounts: [{ customerId: "1111111111", name: "Cuenta nueva" }],
      absoluteTopMinimum: 0.33,
    });
    expect(googleDomainConfigSchema.safeParse(changed).success).toBe(true);
  });

  it("rechaza umbrales fuera de escala y volúmenes que generarían falsos acuses", () => {
    const changed = structuredClone(GOOGLE_ADS_DOMAIN_CONFIG);
    changed.domains[0]!.absoluteTopMinimum = 70;
    expect(googleDomainConfigSchema.safeParse(changed).success).toBe(false);
    changed.domains[0]!.absoluteTopMinimum = 0.7;
    changed.absoluteTop.minImpressions = 0;
    expect(googleDomainConfigSchema.safeParse(changed).success).toBe(false);
  });
});

describe("GET /api/v1/google-domains", () => {
  it("requiere autenticación y devuelve la maestra sin consultar Google", async () => {
    const app = await makeApp();
    try {
      const denied = await app.inject({ url: "/api/v1/google-domains" });
      expect(denied.statusCode).toBe(401);
      const response = await app.inject({ url: "/api/v1/google-domains", headers: { "x-api-key": KEY } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(GOOGLE_ADS_DOMAIN_CONFIG);
      expect(response.json().request_id).toBe(response.headers["x-request-id"]);
      expect(response.body).not.toContain(KEY);
    } finally {
      await app.close();
    }
  });
});
