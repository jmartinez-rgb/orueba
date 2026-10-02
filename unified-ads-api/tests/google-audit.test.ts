import { describe, expect, it } from "vitest";
import { ApiError } from "../src/utils/errors.js";
import { buildXlsx } from "../src/utils/xlsx.js";
import { collectAccount, parseChange } from "../src/providers/google/audit/collect.js";
import { analyzeAccount, globalSummary } from "../src/providers/google/audit/analyze.js";
import { auditMarkdown, accountMarkdown, formatCustomerId } from "../src/providers/google/audit/report.js";
import { auditWorkbook } from "../src/providers/google/audit/workbook.js";
import { auditWindows, Q } from "../src/providers/google/audit/queries.js";
import { anomalyTriggers } from "../src/providers/google/audit/rules-performance.js";
import { competitionPattern, intentCandidates, plain } from "../src/providers/google/audit/rules-search.js";
import { classifyStatus, checkUrls } from "../src/providers/google/audit/url-check.js";
import { conversionShortfallP, poissonLowerTail, rateDropP } from "../src/providers/google/audit/stats.js";
import { fmtShare } from "../src/providers/google/audit/context.js";
import { AUDIT_TARGETS, type UrlCheck } from "../src/providers/google/audit/types.js";
import { ACCOUNT, END, fakeGoogle } from "./google-audit-fixture.js";

const target = AUDIT_TARGETS[0]!;
const fakeUrls = async (urls: string[]): Promise<UrlCheck[]> =>
  urls.map((url) =>
    url.includes("paquetes-viejos")
      ? { url, status: 404, location: null, outcome: "error" }
      : { url, status: 200, location: null, outcome: "ok" },
  );

async function audit(opts: Parameters<typeof fakeGoogle>[0] = {}) {
  const data = await collectAccount(fakeGoogle(opts), target, {
    end: END,
    now: new Date("2026-10-01T15:00:00Z"),
    checkUrls: fakeUrls,
  });
  return analyzeAccount(data);
}
const byTitle = (a: Awaited<ReturnType<typeof audit>>, text: string) => a.findings.find((f) => f.title.includes(text));

describe("Auditoría de Google Ads: lectura", () => {
  it("lee las ocho cuentas del encargo en orden de prioridad", () => {
    expect(AUDIT_TARGETS.map((t) => formatCustomerId(t.id))).toEqual([
      "877-953-6058",
      "621-410-9105",
      "736-792-8294",
      "322-485-0043",
      "811-057-1939",
      "777-162-9164",
      "453-628-2576",
      "197-084-2746",
    ]);
    expect(AUDIT_TARGETS.slice(0, 4).every((t) => t.priority === 1)).toBe(true);
    expect(AUDIT_TARGETS.slice(4).every((t) => t.priority === 2)).toBe(true);
  });

  it("solo usa consultas SELECT y respeta el límite del historial de cambios", async () => {
    const log: string[] = [];
    await audit({ log });
    expect(log.length).toBeGreaterThan(30);
    expect(log.every((q) => q.startsWith("SELECT "))).toBe(true);
    const changes = log.find((q) => q.includes("FROM change_event"))!;
    expect(changes).toMatch(/LIMIT \d+$/);
    expect(changes).toContain("'2026-09-02 00:00:00'");
  });

  it("calcula las ventanas WoW, MoM y 7/14/30/90 sin traslapes", () => {
    const w = Object.fromEntries(auditWindows("2026-09-30").map((x) => [x.key, [x.from, x.to]]));
    expect(w.L7).toEqual(["2026-09-24", "2026-09-30"]);
    expect(w.P7).toEqual(["2026-09-17", "2026-09-23"]);
    expect(w.P30).toEqual(["2026-08-02", "2026-08-31"]);
    expect(w.MTD).toEqual(["2026-09-01", "2026-09-30"]);
    expect(w.PM).toEqual(["2026-08-01", "2026-08-31"]);
    expect(w.PRE_BID).toEqual(["2026-07-18", "2026-08-16"]);
    expect(Object.fromEntries(auditWindows("2026-03-31").map((x) => [x.key, x.to])).PMTD).toBe("2026-02-28");
  });

  it("usa el respaldo cuando Google rechaza los campos ampliados y sigue con las demás secciones", async () => {
    const a = await audit({
      fail: [
        {
          match: "segments.search_term_match_type",
          error: new ApiError("INVALID_REQUEST", "x", {
            details: { google_error_codes: ["PROHIBITED_SEGMENT_IN_SELECT_OR_WHERE_CLAUSE"] },
          }),
        },
        { match: "FROM keyword_view", error: new ApiError("INVALID_REQUEST", "x") },
      ],
    });
    expect(a.data.searchTerms.length).toBeGreaterThan(0);
    expect(a.data.unavailable).toEqual(
      expect.arrayContaining([
        {
          section: "Términos de búsqueda (campos ampliados)",
          reason: "INVALID_REQUEST (PROHIBITED_SEGMENT_IN_SELECT_OR_WHERE_CLAUSE)",
        },
        { section: "Métricas de keywords", reason: "INVALID_REQUEST" },
      ]),
    );
    expect(a.status).toBe("ok");
  });

  it("detiene la lectura si la autenticación falla", async () => {
    await expect(
      audit({ fail: [{ match: "FROM campaign WHERE segments.date", error: new ApiError("AUTH_ERROR", "x") }] }),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
  });

  it("reporta una cuenta sin acceso sin inventar datos", async () => {
    const data = await collectAccount(fakeGoogle(), AUDIT_TARGETS[1]!, { end: END });
    const a = analyzeAccount(data);
    expect(a.status).toBe("sin_acceso");
    expect(a.findings).toHaveLength(0);
    expect(accountMarkdown(a)).toContain("Sin lectura de la cuenta");
    expect(accountMarkdown(a)).toContain("ACCESS_DENIED (USER_PERMISSION_DENIED)");
  });

  it("atribuye un cambio de presupuesto a la campaña que lo usa con montos antes y después", async () => {
    const a = await audit();
    expect(a.data.changes[0]).toMatchObject({
      campaignId: "1",
      before: { presupuesto: 800 },
      after: { presupuesto: 1000 },
    });
    expect(
      parseChange({
        changeEvent: {
          changedFields: "status",
          oldResource: { campaign: { status: "PAUSED" } },
          newResource: { campaign: { status: "ENABLED" } },
        },
      }).after,
    ).toEqual({ estado: "ENABLED" });
  });
});

describe("Auditoría de Google Ads: diagnóstico", () => {
  it("encuentra los errores críticos (P0) del escenario", async () => {
    const a = await audit();
    const p0 = a.findings.filter((f) => f.priority === "P0");
    expect(p0.find((f) => f.rule === "RULE-GADS-001")?.campaign).toBe("Search Respaldo");
    expect(byTitle(a, "Etiquetado automático")?.priority).toBe("P0");
    expect(byTitle(a, "anuncio activo rechazado")).toMatchObject({ priority: "P0", risk: "bajo" });
    expect(p0.find((f) => f.rule === "RULE-GADS-006")?.evidence.join(" ")).toContain("paquetes-viejos → HTTP 404");
    expect(byTitle(a, "Formulario web dejó de registrar")).toMatchObject({ priority: "P0", rule: "RULE-GADS-005" });
  });

  it("propone subir 15% el presupuesto solo en la campaña limitada con buen CPA", async () => {
    const a = await audit();
    const budget = a.findings.filter((f) => f.rule === "RULE-GADS-003");
    expect(budget).toHaveLength(1);
    expect(budget[0]).toMatchObject({ campaign: "Search Marca", risk: "moderado", priority: "P2", confidence: "alta" });
    expect(budget[0]!.action).toContain("$1,150 MXN");
    expect(budget[0]!.rollback).toContain("$1,000 MXN");
    // El presupuesto cambió hace dos días: el ajuste espera una semana completa.
    expect(budget[0]!.action).toContain("Esperar al 2026-10-05");
    expect(budget[0]!.when).toBe("semana");
  });

  it("detecta el deterioro sostenido con pruebas estadísticas y pide investigar antes de tocar", async () => {
    const a = await audit();
    const anomaly = a.findings.find((f) => f.campaign === "Search Genérica" && f.title.startsWith("Anomalía"))!;
    expect(anomaly.title).toContain("gasto ↑ y conversiones ↓");
    expect(anomaly.title).toContain("CPA ↑");
    expect(anomaly).toMatchObject({ confidence: "alta", risk: "bajo", priority: "P2" });
    expect(anomaly.action).toContain("Investigar");
    // La campaña estable no dispara anomalías.
    expect(a.findings.some((f) => f.campaign === "Search Marca" && f.title.startsWith("Anomalía"))).toBe(false);
  });

  it("propone negativas solo para intención irrelevante, sin tocar keywords activas", async () => {
    const a = await audit();
    const jobs = byTitle(a, "Búsqueda de empleo")!;
    expect(jobs).toMatchObject({ priority: "P1", risk: "bajo", confidence: "alta", when: "hoy" });
    expect(jobs.evidence.join(" ")).toContain("vacantes izzi");
    expect(byTitle(a, "Cliente actual o soporte")?.confidence).toBe("media");
    const candidates = intentCandidates(a.data).map((t) => t.term);
    expect(candidates).not.toContain("internet izzi");
    expect(candidates).not.toContain("izzi internet 100 megas");
    expect(byTitle(a, "convierte mejor que su campaña")?.evidence.join(" ")).toContain("izzi internet 100 megas");
  });

  it("revisa creativos, assets y PMax con acciones de bajo riesgo", async () => {
    const a = await audit();
    expect(byTitle(a, "RSA con recursos incompletos")?.evidence.join(" ")).toContain("8 títulos / 3 descripciones");
    expect(byTitle(a, "Sitelinks por debajo de 4")?.priority).toBe("P1");
    expect(byTitle(a, "Textos destacados por debajo de 4")).toBeDefined();
    expect(byTitle(a, "Fragmentos estructurados")).toBeUndefined();
    expect(byTitle(a, "vencido o con fechas")?.evidence.join(" ")).toContain("Promo septiembre 2025");
    expect(byTitle(a, "grupo de recursos con textos o formatos faltantes")?.evidence.join(" ")).toMatch(
      /10 títulos.*imagen vertical.*video propio/,
    );
    expect(byTitle(a, "sin intención de compra recibe gasto")?.evidence.join(" ")).toContain("/empleo/vacantes");
  });

  it("no elige acciones primarias: marca los riesgos de conversión como estructurales", async () => {
    const a = await audit();
    expect(byTitle(a, "Microconversión marcada como primaria")).toMatchObject({
      risk: "alto",
      priority: "P4",
      when: "no_ejecutar",
    });
    expect(byTitle(a, "suma leads y ventas")).toMatchObject({ risk: "alto", priority: "P4" });
    expect(a.holds.some((h) => h.item === "Objetivos y acciones de conversión")).toBe(true);
  });

  it("separa segmentos con evidencia estadística y no excluye por pocos datos", async () => {
    const a = await audit();
    const geo = byTitle(a, "región con CPA significativamente peor")!;
    expect(geo.evidence.join(" ")).toContain("Chiapas");
    expect(geo.evidence.join(" ")).not.toContain("Jalisco:");
    expect(geo.action).toContain("No excluir todavía");
    expect(byTitle(a, "Móvil convierte significativamente peor")?.risk).toBe("bajo");
    expect(byTitle(a, "socios de búsqueda")?.priority).toBe("P2");
    expect(byTitle(a, "apps de juegos")?.evidence.join(" ")).toContain("Candy Puzzle Games");
    expect(byTitle(a, "Demand Gen menor a 10 veces")?.priority).toBe("P3");
  });

  it("protege lo reciente y lo que está en aprendizaje (No tocar todavía)", async () => {
    const a = await audit();
    expect(a.holds.find((h) => h.campaign === "Search Marca" && h.item === "Presupuesto y puja")?.reason).toContain(
      "últimos 7 días",
    );
    expect(a.holds.some((h) => h.item === "Programación de anuncios")).toBe(true);
    expect(a.changes[0]).toMatchObject({
      campaign: "Search Marca",
      element: "CAMPAIGN_BUDGET",
    });
    expect(a.changes[0]!.conclusion).toContain("Muy reciente para evaluar");
  });

  it("limita los quick wins a 10 acciones P0/P1 de bajo riesgo", async () => {
    const a = await audit();
    expect(a.quickWins.length).toBeGreaterThan(3);
    expect(a.quickWins.length).toBeLessThanOrEqual(10);
    expect(a.quickWins.every((f) => (f.priority === "P0" || f.priority === "P1") && f.risk === "bajo")).toBe(true);
    expect(a.quickWins[0]!.priority).toBe("P0");
  });

  it("clasifica las recomendaciones de Google en lugar de aplicarlas", async () => {
    const a = await audit();
    const verdict = Object.fromEntries(a.recommendations.map((r) => [r.type, r.verdict]));
    expect(verdict).toEqual({
      SITELINK_ASSET: "Aplicable",
      DISPLAY_EXPANSION_OPT_IN: "No recomendable",
      CAMPAIGN_BUDGET: "Aplicable",
    });
  });
});

describe("Auditoría de Google Ads: informe", () => {
  it("entrega las 22 secciones por cuenta, el resumen general y sin emojis", async () => {
    const ok = await audit();
    const denied = analyzeAccount(await collectAccount(fakeGoogle(), AUDIT_TARGETS[1]!, { end: END }));
    const md = auditMarkdown([ok, denied], { generatedAt: "1/10/2026", version: "v25" });
    for (const heading of [
      "## 1. Estado general",
      "## 2. Principales hallazgos",
      "## 3. P0 — Errores críticos",
      "## 4. P1 — Quick Wins",
      "## 5. Search",
      "## 6. Performance Max",
      "## 7. Demand Gen / Display / Video",
      "## 8. Presupuesto",
      "## 9. Smart Bidding",
      "## 10. Conversiones",
      "## 11. Search Terms",
      "## 12. Keywords",
      "## 13. Creativos",
      "## 14. Assets",
      "## 15. Geografía",
      "## 16. Dispositivos",
      "## 17. Horarios",
      "## 18. URLs / Landing Pages",
      "## 19. Cambios recientes",
      "## 20. No tocar todavía",
      "## 21. Experimentos recomendados",
      "## 22. Plan de acción",
    ])
      expect(md).toContain(heading);
    for (const text of [
      "Customer ID: 877-953-6058",
      "# GOOGLE ADS AUDIT — RESUMEN GENERAL",
      "## TOP 10 OPORTUNIDADES",
      "## TOP 10 QUICK WINS",
      "## PRINCIPALES ERRORES",
      "## PRINCIPALES RIESGOS",
      "## CAMBIOS QUE NO DEBEMOS REALIZAR TODAVÍA",
      "**¿Qué está bien y no debemos tocar?**",
      "**¿Qué requiere mayor análisis antes de tocarlo?**",
      "**Cambio detectado**",
      "**ROLLBACK:**",
      "RULE-GADS-001",
      "SOLO LECTURA",
    ])
      expect(md).toContain(text);
    expect(md).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(md.indexOf("# izzi – Performance AO - mxn\n")).toBeLessThan(md.indexOf("# izzi – Performance AO - mxn 2"));
  });

  it("arma el Excel de evidencia y el resumen global con las reglas de monitoreo", async () => {
    const a = await audit();
    const denied = analyzeAccount(await collectAccount(fakeGoogle(), AUDIT_TARGETS[1]!, { end: END }));
    const sheets = auditWorkbook([a, denied], { generatedAt: "1/10/2026", version: "v25" });
    expect(sheets.map((s) => s.name)).toEqual([
      "Resumen",
      "Hallazgos",
      "Campañas",
      "Tendencia",
      "Términos candidatos",
      "RSA",
      "Conversiones",
      "Geografía",
      "Cambios",
      "Recomendaciones Google",
      "No tocar",
      "URLs",
      "Sin datos",
    ]);
    expect(buildXlsx(sheets).subarray(0, 2).toString()).toBe("PK");
    const g = globalSummary([a]);
    expect(g.quickWins.length).toBeLessThanOrEqual(10);
    expect(g.rules.find((r) => r.id === "RULE-GADS-003")?.accounts).toEqual([target.name]);
  });

  it("no expone tokens ni cuerpos de respuesta en el informe", async () => {
    const md = auditMarkdown([await audit()], { generatedAt: "x", version: "v25" });
    expect(md).not.toMatch(/refresh|developer-token|Bearer|ya29\./i);
    expect(md).toContain(ACCOUNT.slice(0, 3));
  });
});

describe("Auditoría de Google Ads: utilidades", () => {
  it("las pruebas estadísticas distinguen ruido de una caída real", () => {
    expect(poissonLowerTail(2, 45)).toBeLessThan(1e-10);
    expect(poissonLowerTail(9, 10)).toBeGreaterThan(0.3);
    expect(rateDropP(100, 1000, 95, 1000)!).toBeGreaterThan(0.3);
    expect(rateDropP(100, 1000, 40, 1000)!).toBeLessThan(0.001);
    expect(conversionShortfallP(5, 0)).toBeNull();
  });

  it("no dispara anomalías con fluctuaciones pequeñas", () => {
    const t = (cost: number, conversions: number) => ({
      cost,
      impressions: 10000,
      clicks: 500,
      interactions: 500,
      conversions,
      value: 0,
      allConversions: conversions,
      calls: 0,
      sales: 0,
      leads: 0,
      days: 7,
    });
    expect(anomalyTriggers(t(1000, 50), t(950, 52), "7 vs 7")).toEqual([]);
    expect(anomalyTriggers(t(1400, 20), t(1000, 50), "7 vs 7").map((x) => x.code)).toEqual(
      expect.arrayContaining([1, 6]),
    );
  });

  it("interpreta los topes de cuota de impresiones de Google", () => {
    expect(fmtShare(0.0999)).toBe("<10%");
    expect(fmtShare(0.9001)).toBe(">90%");
    expect(fmtShare(0.42)).toBe("42%");
  });

  it("excluye la marca propia de la lista de competencia y compara sin acentos", () => {
    expect(competitionPattern("izzi - Ofertas").test("izzi internet")).toBe(false);
    expect(competitionPattern("izzi - Ofertas").test("sky vs izzi")).toBe(true);
    expect(competitionPattern("Sky - ABCW").test("sky hd")).toBe(false);
    expect(plain("Contraseña  Señal")).toBe("contrasena senal");
  });

  it("clasifica respuestas HTTP sin acusar bloqueos de bots como errores", async () => {
    expect([200, 301, 404, 410, 500, 403, 429, 503].map(classifyStatus)).toEqual([
      "ok",
      "redirect",
      "error",
      "error",
      "error",
      "unverifiable",
      "unverifiable",
      "unverifiable",
    ]);
    const calls: Array<RequestInit | undefined> = [];
    const result = await checkUrls(["https://a.test/x", "https://a.test/y"], async (url, init) => {
      calls.push(init);
      if (String(url).endsWith("y")) throw new Error("red");
      return new Response("", { status: 301, headers: { location: "https://b.test/" } });
    });
    expect(result).toEqual([
      { url: "https://a.test/x", status: 301, location: "https://b.test/", outcome: "redirect" },
      { url: "https://a.test/y", status: null, location: null, outcome: "unverifiable" },
    ]);
    expect(calls.every((c) => c?.redirect === "manual" && c.method === "GET")).toBe(true);
  });

  it("todas las consultas son de lectura", () => {
    const w = auditWindows(END)[0]!;
    const qs = Object.entries(Q).map(([name, fn]) => {
      const f = fn as (...a: unknown[]) => string;
      if (["daily", "dailyBasic", "actionsDaily", "changes"].includes(name)) return f(w.from, w.to, 10);
      if (name === "geoNames") return f(["geoTargetConstants/1"]);
      if (["keywords", "ads"].includes(name)) return f(10);
      return f(w, 10);
    });
    expect(
      qs.every(
        (q) =>
          /^SELECT /.test(q) &&
          !/\b(INSERT|UPDATE|DELETE|MUTATE)\b/i.test(q.replace(/change_event\.resource_change_operation/g, "")),
      ),
    ).toBe(true);
  });
});
