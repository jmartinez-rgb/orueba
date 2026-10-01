import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { resetAuthConfig } from "@/lib/auth/config";
import { can, PERMISSIONS } from "@/lib/auth/roles";
import { createAccount, deleteAccount, updateAccount, updateUniversal, changeOwnPassword, type Actor } from "@/lib/auth/user-admin";
import { effectiveUniversal, findEffectiveAccount, generatePassword, passwordProblem, resetUsersCache } from "@/lib/auth/users";
import { getRecordStore } from "@/lib/records/store";
import { brandOfAccount, brandOfCampaign, parseBrand } from "@/lib/brands";
import { BrandScopedSource } from "@/lib/data/brand-source";
import { MockDataSource } from "@/lib/mock/mock-source";
import { reconcile } from "@/lib/alerts/incident-manager";
import { emptyAlertState } from "@/lib/alerts/types";
import { runMonitoring } from "@/lib/monitoring/monitoring-engine";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { buildReportMessage, shortAccount } from "@/lib/reports/format";

const admin: Actor = { id: "jmartinez", name: "J. Martínez", permissions: PERMISSIONS };

describe("cuentas, contraseñas y permisos desde la app", () => {
  const prev = { ...process.env };
  beforeEach(async () => {
    process.env.AUTH_SECRET = "s".repeat(48);
    process.env.AUTH_USERS = JSON.stringify([{ u: "jmartinez", n: "J. Martínez", r: "admin", h: await hashPassword("Admin-Netlify-2026") }]);
    process.env.AUTH_UNIVERSAL_PASSWORD_HASH = await hashPassword("Universal-Netlify-2026");
    resetAuthConfig();
    await getRecordStore().delete("auth/users");
    await getRecordStore().delete("auth/universal");
    resetUsersCache();
  });
  afterEach(() => {
    process.env = { ...prev };
    resetAuthConfig();
    resetUsersCache();
  });

  it("la gestión de usuarios es solo del administrador", () => {
    expect(can("admin", "users:manage")).toBe(true);
    expect(can("coadmin", "users:manage")).toBe(false);
    expect(can("coadmin", "settings:write")).toBe(true);
  });

  it("contraseñas generadas seguras y reglas mínimas", () => {
    for (let i = 0; i < 300; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^Mmc-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
      expect(passwordProblem(p)).toBeNull(); // siempre pasa la regla (letras y números)
    }
    expect(passwordProblem("corta1")).toContain("10");
    expect(passwordProblem("sololetrassinnumero")).toContain("números");
  });

  it("crea una cuenta con permisos personalizados y marcas; nunca guarda la contraseña en claro", async () => {
    const res = await createAccount(admin, { username: "Ana.Lopez", name: "Ana López", role: "viewer", permissions: ["tickets:write", "reports:write", "alerts:write"], brands: ["sky"], password: "Sky-Monitoreo-2026" });
    expect(res.ok).toBe(true);
    const acc = await findEffectiveAccount("ana.lopez");
    // Los personalizados se respetan; todo rol interno suma el acceso al monitoreo y a la vista del cliente.
    expect(acc?.permissions).toEqual(["tickets:write", "reports:write", "alerts:write", "internal:view", "client:view"]);
    expect(acc?.brands).toEqual(["sky"]);
    expect(acc?.source).toBe("app");
    const raw = JSON.stringify(await getRecordStore().get("auth/users"));
    expect(raw).not.toContain("Sky-Monitoreo-2026");
    expect(await verifyPassword("Sky-Monitoreo-2026", acc!.hash)).toBe(true);
    // Usuario repetido y permisos que el actor no tiene.
    expect((await createAccount(admin, { username: "ana.lopez", name: "Otra Ana", role: "viewer", password: "Sky-Monitoreo-2026" })).ok).toBe(false);
    const limited: Actor = { id: "ops", name: "Ops", permissions: ["users:manage", "tickets:write"] };
    const denied = await createAccount(limited, { username: "nuevo", name: "Nuevo Admin", role: "admin", password: "Sky-Monitoreo-2026" });
    expect(denied.ok).toBe(false);
  });

  it("cambiar la contraseña o desactivar sube la versión (cierra sesiones) y no deja sin administrador", async () => {
    await createAccount(admin, { username: "ana", name: "Ana López", role: "manager", password: "Primera-Clave-2026" });
    const v1 = (await findEffectiveAccount("ana"))!.version;
    const changed = await updateAccount(admin, "ana", { password: "Segunda-Clave-2026" });
    expect(changed.ok).toBe(true);
    const acc = (await findEffectiveAccount("ana"))!;
    expect(acc.version).toBe(v1 + 1);
    expect(await verifyPassword("Segunda-Clave-2026", acc.hash)).toBe(true);
    expect((await updateAccount(admin, "ana", { active: false })).ok).toBe(true);
    expect((await findEffectiveAccount("ana"))!.active).toBe(false);
    // No puede quitarse a sí mismo el acceso ni dejar la app sin quien administre usuarios.
    expect((await updateAccount(admin, "jmartinez", { role: "viewer" })).ok).toBe(false);
    expect((await deleteAccount(admin, "jmartinez")).ok).toBe(false);
  });

  it("el administrador cambia la contraseña de una cuenta de Netlify sin tocar Netlify", async () => {
    const other: Actor = { id: "otro-admin", name: "Otro", permissions: PERMISSIONS };
    const res = await updateAccount(other, "jmartinez", { password: "Nueva-Clave-App-2026" });
    expect(res.ok).toBe(true);
    const acc = (await findEffectiveAccount("jmartinez"))!;
    expect(acc.source).toBe("netlify+app");
    expect(await verifyPassword("Nueva-Clave-App-2026", acc.hash)).toBe(true);
    expect(await verifyPassword("Admin-Netlify-2026", acc.hash)).toBe(false);
    // Quitar los cambios de la app vuelve a la cuenta de Netlify.
    const del = await deleteAccount(other, "jmartinez");
    expect(del.ok && del.value.revertedTo).toBe("netlify");
    expect(await verifyPassword("Admin-Netlify-2026", (await findEffectiveAccount("jmartinez"))!.hash)).toBe(true);
  });

  it("cada persona cambia su propia contraseña con la actual", async () => {
    await createAccount(admin, { username: "luis", name: "Luis Pérez", role: "viewer", password: "Luis-Clave-2026" });
    expect((await changeOwnPassword("luis", "incorrecta-2026", "Luis-Nueva-2026")).ok).toBe(false);
    const ok = await changeOwnPassword("luis", "Luis-Clave-2026", "Luis-Nueva-2026");
    expect(ok.ok).toBe(true);
    expect(await verifyPassword("Luis-Nueva-2026", (await findEffectiveAccount("luis"))!.hash)).toBe(true);
  });

  it("contraseña universal desde la app: reemplaza a la de Netlify, rol limitado y se puede desactivar", async () => {
    expect((await effectiveUniversal()).source).toBe("netlify");
    expect((await updateUniversal(admin, { password: "Universal-App-2026", role: "manager", brands: ["izzi"] })).ok).toBe(true);
    const u = await effectiveUniversal();
    expect(u.source).toBe("app");
    expect(u.role).toBe("manager");
    expect(u.brands).toEqual(["izzi"]);
    expect(await verifyPassword("Universal-App-2026", u.hash!)).toBe(true);
    expect((await updateUniversal(admin, { role: "admin" })).ok).toBe(false);
    expect((await updateUniversal(admin, { enabled: false })).ok).toBe(true);
    expect((await effectiveUniversal()).enabled).toBe(false);
  });
});

describe("izzi y Sky por nombre de cuenta", () => {
  it("clasifica cuentas y campañas como en la hoja", () => {
    expect(brandOfAccount("Sky - ABCW")).toBe("sky");
    expect(brandOfAccount("Sky Performance - MXN")).toBe("sky");
    expect(brandOfAccount("Sky México")).toBe("sky");
    expect(brandOfAccount("izzi – Performance AO - mxn")).toBe("izzi");
    expect(brandOfAccount("MXN - IZZI WHATSAPP")).toBe("izzi");
    expect(brandOfAccount("izzi - Sky Social")).toBeNull(); // mixta
    expect(brandOfCampaign("izzi - Sky Social", "Sky / Seguidores Instagram / Septiembre 2026")).toBe("sky");
    expect(brandOfCampaign("izzi - Sky Social", "izzi / Seguidores Meta / Septiembre 2026")).toBe("izzi");
    // Una cuenta de izzi que promociona contenido de Sky sigue siendo izzi.
    expect(brandOfCampaign("izzi Telecom - MXN", "WhatsApp//SKY SPORTS//izzi telecom")).toBe("izzi");
    expect(brandOfCampaign("Discovery", "PMAX | Caricaturas")).toBe("izzi");
    expect(brandOfAccount("Skyline")).toBeNull();
    expect(parseBrand("SKY")).toBe("sky");
    expect(parseBrand("otra")).toBe("izzi");
  });

  it("cada marca ve solo sus cuentas, campañas y plataformas; los totales no se mezclan", async () => {
    const inner = new MockDataSource({ scenarioId: "normal", timezone: DEFAULT_SETTINGS.timezone, referenceTime: "2026-09-28T20:30:00Z", ingestion: {} });
    const izzi = new BrandScopedSource(inner, "izzi");
    const sky = new BrandScopedSource(inner, "sky");
    const [ci, cs, full] = await Promise.all([izzi.getCatalog(), sky.getCatalog(), inner.getCatalog()]);
    expect(cs.accounts.map((a) => a.name).sort()).toEqual(["Sky - ABCW", "Sky México", "Sky Performance - MXN", "Sky Sports", "izzi - Sky Social"].sort());
    expect(ci.accounts.some((a) => a.name === "Sky - ABCW")).toBe(false);
    // La cuenta mixta aparece en ambas, cada una con sus campañas.
    expect(ci.campaigns.find((c) => c.id === "m-2505")).toBeDefined();
    expect(ci.campaigns.find((c) => c.id === "m-2504")).toBeUndefined();
    expect(cs.campaigns.find((c) => c.id === "m-2504")).toBeDefined();
    expect(ci.campaigns.length + cs.campaigns.length).toBe(full.campaigns.length);
    expect(await sky.platforms()).toEqual(["google", "meta", "tiktok"]);
    // Suma por plataforma = suma de las dos marcas.
    const dates = ["2026-09-27"];
    const [all, a, b] = await Promise.all([
      inner.getHourly({ dates, level: "platform", platforms: ["meta"] }),
      izzi.getHourly({ dates, level: "platform", platforms: ["meta"] }),
      sky.getHourly({ dates, level: "platform", platforms: ["meta"] }),
    ]);
    const total = (rows: typeof all) => rows.reduce((s, r) => s + (r.metrics.spend ?? 0), 0);
    expect(total(a) + total(b)).toBeCloseTo(total(all), 4);
    expect(total(b)).toBeGreaterThan(0);
    expect(await sky.getHourly({ dates, level: "platform", platforms: ["microsoft"] })).toEqual([]);
  });

  it("Sky tiene sus propios folios y mensajes; izzi conserva los de siempre", async () => {
    const inner = new MockDataSource({ scenarioId: "meta-delayed", timezone: DEFAULT_SETTINGS.timezone, referenceTime: "2026-09-28T20:30:00Z", ingestion: {} });
    const sky = new BrandScopedSource(inner, "sky");
    const settings = { ...DEFAULT_SETTINGS, monitoredPlatforms: await sky.platforms() };
    const run = await runMonitoring(sky, { settings, asOf: new Date("2026-09-28T20:30:00Z") });
    const whatsapp = { templateAlert: "a", templateRecovery: "b", templateLanguage: "es_MX" };
    const res = reconcile(emptyAlertState(), run, { settings, notify: true, whatsapp, brand: { name: "Sky", upper: "SKY", idPrefix: "SKY-" } });
    expect(res.state.alerts.length).toBeGreaterThan(0);
    expect(res.state.alerts.every((a) => a.id.startsWith("SKY-ALT-"))).toBe(true);
    expect(res.state.incidents.every((i) => i.id.startsWith("SKY-INC-"))).toBe(true);
    for (const n of res.notifications) {
      expect(n.id.startsWith("SKY-NTF-")).toBe(true);
      expect(n.text).toContain("SKY MEDIA");
    }
    const plain = reconcile(emptyAlertState(), run, { settings, notify: false, whatsapp });
    expect(plain.state.alerts.every((a) => /^ALT-\d+$/.test(a.id))).toBe(true);
  });

  it("mensaje de monitoreo: nombres cortos de Sky y la marca en el saludo", () => {
    expect(shortAccount("Sky - ABCW")).toBe("ABCW");
    expect(shortAccount("izzi - Ofertas")).toBe("Ofertas");
    const base = {
      generatedAt: "",
      businessDate: "2026-09-28",
      cutoffHour: 14,
      timezone: "America/Mexico_City",
      lastWeekDay: "lunes",
      greeting: "Buenas tardes",
      budget: { status: "ok" as const, details: [] },
      platformProblems: { status: "ok" as const, details: [] },
      platforms: [],
      confidence: 90,
      thresholds: { spendIncreaseVsYesterday: 0.3, spendChangeVsLastWeek: 0.3, conversionDrop: 0.3 },
      manualChecks: [],
      closingNote: "",
      accountBreakdown: [],
    };
    const opts = { overrides: {}, platforms: [], includeConfidence: false } as unknown as Parameters<typeof buildReportMessage>[1];
    expect(buildReportMessage({ ...base, brandName: "Sky" }, opts).split("\n")[0]).toBe("Buenas tardes equipo, comparto el monitoreo de Sky:");
    expect(buildReportMessage({ ...base, brandName: "izzi" }, opts).split("\n")[0]).toBe("Buenas tardes equipo, comparto el monitoreo:");
  });
});
