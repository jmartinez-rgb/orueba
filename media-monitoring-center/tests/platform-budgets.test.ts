import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { fetchUnifiedBudgets, type UnifiedBudget } from "@/lib/integrations/unified-api";
import { buildBudgetOverview, type BudgetInput } from "@/lib/services/platform-budgets";
import { DEFAULT_CLASSIFIERS } from "@/lib/classifiers/defaults";
import type { Campaign } from "@/lib/types";

const at = "2026-10-01T18:00:00.000Z";
function budget(p: Partial<UnifiedBudget> & Pick<UnifiedBudget, "platform" | "campaign_id" | "campaign_name">): UnifiedBudget {
  return {
    account_id: "a1",
    account_name: "MXN - izzi 1",
    currency: "MXN",
    objective: null,
    budget_level: "campaign",
    ad_set_id: null,
    ad_set_name: null,
    budget_type: "daily",
    daily_budget: 1000,
    lifetime_budget: null,
    budget_remaining: null,
    daily_estimate: null,
    shared_budget_id: null,
    limited_by_budget: null,
    recommended_daily_budget: null,
    end_time: null,
    extracted_at: at,
    ...p,
  };
}
function input(budgets: UnifiedBudget[], extra: Partial<BudgetInput> = {}): BudgetInput {
  return {
    budgets,
    brand: "izzi",
    platforms: ["meta", "google", "tiktok", "microsoft"],
    classifiers: DEFAULT_CLASSIFIERS,
    campaigns: new Map<string, Campaign>(),
    spendToday: new Map(),
    curveShare: { meta: 0.5, google: 0.5 },
    fxRate: 18,
    thresholds: { attention: 0.15, alert: 0.25 },
    ...extra,
  };
}

describe("presupuesto diario por plataforma y estrategia", () => {
  it("agrupa Meta con su clasificador, convierte USD y compara contra el gasto y la curva", () => {
    const view = buildBudgetOverview(
      input(
        [
          budget({ platform: "meta", campaign_id: "1", campaign_name: "Performance | CAPI WHATSAPP | Hogar", daily_budget: 2000 }),
          budget({ platform: "meta", campaign_id: "2", campaign_name: "Venta Sitio Web", daily_budget: 100, currency: "USD" }),
          budget({ platform: "meta", campaign_id: "3", campaign_name: "Performance | CAPI WHATSAPP | Móvil", budget_level: "ad_set", ad_set_id: "31", daily_budget: 500 }),
          budget({ platform: "meta", campaign_id: "3", campaign_name: "Performance | CAPI WHATSAPP | Móvil", budget_level: "ad_set", ad_set_id: "32", daily_budget: 500 }),
          budget({ platform: "meta", campaign_id: "9", campaign_name: "Sky Sports", account_name: "Sky - ABCW", daily_budget: 9999 }),
        ],
        {
          spendToday: new Map([
            ["meta:1", 1000],
            ["meta:2", 300],
            ["meta:3", 0],
          ]),
        },
      ),
    );
    const meta = view.platforms[0]!;
    expect(meta.platform).toBe("meta");
    expect(meta.total).toMatchObject({ total: 4800, spend: 1300, campaigns: 3, adSets: 2, idle: 1, idleBudget: 1000 });
    expect(meta.strategies.map((s) => [s.label, s.total, s.spend])).toEqual([
      ["CAPI WhatsApp", 3000, 1000],
      ["Web", 1800, 300],
    ]);
    // CAPI: 1000 gastado de 1500 esperados a mitad del día → 67 %, por debajo del umbral de atención.
    expect(meta.strategies[0]).toMatchObject({ expectedNow: 1500, paceLabel: "below" });
    expect(meta.insights.some((i) => i.text.includes("CAPI WhatsApp concentra 63%"))).toBe(true);
    expect(meta.insights.some((i) => i.text.includes("no ha gastado hoy"))).toBe(true);
  });

  it("cuenta una vez el presupuesto compartido de Google y reporta las limitadas con su recomendación", () => {
    const view = buildBudgetOverview(
      input([
        budget({ platform: "google", campaign_id: "g1", campaign_name: "Search Genéricas", shared_budget_id: "77", daily_budget: 3000, limited_by_budget: true, recommended_daily_budget: 4000 }),
        budget({ platform: "google", campaign_id: "g2", campaign_name: "Search Genéricas 2", shared_budget_id: "77", daily_budget: 3000, limited_by_budget: true, recommended_daily_budget: 4000 }),
        budget({ platform: "google", campaign_id: "g3", campaign_name: "izzi Pmax Hogar", daily_budget: 1000 }),
      ]),
    );
    const google = view.platforms[0]!;
    expect(google.total.total).toBe(4000);
    expect(google.structure.shared).toBe(1);
    expect(google.units[0]).toMatchObject({ level: "shared", budget: 3000, limited: true });
    expect(google.insights.some((i) => i.text.includes("1 campaña limitada") && i.text.includes("$1,000"))).toBe(true);
  });

  it("los totales sin diario estimable no suman; sin tasa, el USD queda fuera con aviso", () => {
    const view = buildBudgetOverview(
      input(
        [
          budget({ platform: "microsoft", campaign_id: "m1", campaign_name: "Search", budget_type: "lifetime", daily_budget: null, lifetime_budget: 12000 }),
          budget({ platform: "microsoft", campaign_id: "m2", campaign_name: "Marca", daily_budget: 500 }),
          budget({ platform: "tiktok", campaign_id: "t1", campaign_name: "Sky", daily_budget: 50, currency: "USD" }),
        ],
        { fxRate: null },
      ),
    );
    expect(view.platforms.map((p) => [p.platform, p.total.total])).toEqual([["microsoft", 500]]);
    expect(view.excluded).toEqual({ rows: 1, currencies: ["USD"] });
    expect(view.platforms[0]!.insights.some((i) => i.text.includes("sin diario estimable"))).toBe(true);
    expect(view.insights.some((i) => i.text.includes("falta de tasa"))).toBe(true);
  });

  it("el total combina plataformas y su ritmo usa lo esperado de cada una", () => {
    const view = buildBudgetOverview(
      input(
        [budget({ platform: "meta", campaign_id: "1", campaign_name: "Venta", daily_budget: 1000 }), budget({ platform: "google", campaign_id: "g", campaign_name: "Search", daily_budget: 1000 })],
        {
          spendToday: new Map([
            ["meta:1", 500],
            ["google:g", 500],
          ]),
        },
      ),
    );
    expect(view.total).toMatchObject({ total: 2000, spend: 1000, expectedNow: 1000, pace: 1, paceLabel: "on" });
    expect(view.insights.some((i) => i.tone === "good")).toBe(true);
  });
});

describe("lectura sin saturar", () => {
  it("detalla las desviaciones grandes y resume las menores en una línea", () => {
    const names = ["Venta", "Sitio Web", "Llamada", "Auronix", "SALES"];
    const spend = [100, 300, 780, 800, 820]; // contra 1000 esperados a mitad del día (presupuesto 2000)
    const view = buildBudgetOverview(
      input(
        names.map((n, i) => budget({ platform: "meta", campaign_id: String(i), campaign_name: n, daily_budget: 2000 })),
        { spendToday: new Map(names.map((_, i) => [`meta:${i}`, spend[i]!])) },
      ),
    );
    const warns = view.platforms[0]!.insights.filter((i) => i.tone === "warn").map((i) => i.text);
    expect(warns[0]).toMatch(/^Venta va al 10%.*revisa entrega/);
    expect(warns[1]).toMatch(/^Web va al 30%/);
    expect(warns[2]).toBe("Además, 3 grupos van por debajo de lo esperado a esta hora (entre 78% y 82%): Llamadas, Auronix, Sales Force.");
  });
});

describe("lectura de presupuestos desde la API unificada", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  it("valida la respuesta, usa la llave interna y conserva avisos por proveedor", async () => {
    vi.stubEnv("UNIFIED_ADS_API_URL", "https://api.ejemplo.mx");
    vi.stubEnv("UNIFIED_ADS_API_KEY", "llave-interna-0123456789abcdef");
    resetEnvCache();
    const request = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.ejemplo.mx/api/v1/budgets");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("llave-interna-0123456789abcdef");
      return Response.json({
        data: [{ ...budget({ platform: "meta", campaign_id: "1", campaign_name: "Venta" }), client_id: null, start_time: null, raw_metrics: {} }],
        errors: [{ provider: "tiktok", error: { code: "ACCESS_DENIED", message: "Sin permiso", request_id: "r" } }],
        request_id: "r",
      });
    });
    const res = await fetchUnifiedBudgets(request as unknown as typeof fetch);
    expect(res).toMatchObject({ ok: true, budgets: [{ campaign_id: "1" }], warnings: ["tiktok: Sin permiso"] });
    const bad = await fetchUnifiedBudgets((async () => Response.json({ data: [{ nope: 1 }], errors: [] })) as unknown as typeof fetch);
    expect(bad).toMatchObject({ ok: false, configured: true });
  });
  it("sin configuración no consulta nada", async () => {
    vi.stubEnv("UNIFIED_ADS_API_URL", "");
    resetEnvCache();
    const request = vi.fn();
    expect(await fetchUnifiedBudgets(request as unknown as typeof fetch)).toMatchObject({ ok: false, configured: false });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("cierre de mes con los diarios actuales", () => {
  const month = { daysInMonth: 31, elapsedDays: 10, lines: { meta: { budget: 100000, spend: 40000 }, google: { budget: 50000, spend: 20000 } } };
  it("proyecta gasto del mes + resto de hoy + diario por los días que faltan y calcula el diario necesario", () => {
    const view = buildBudgetOverview(
      input([budget({ platform: "meta", campaign_id: "1", campaign_name: "Venta", daily_budget: 4000 })], {
        spendToday: new Map([["meta:1", 1000]]),
        month,
        budgetThresholds: { overspendAttention: 0.05, underspendAttention: 0.1 },
      }),
    );
    // 40,000 + (4,000 − 1,000) + 4,000 × 20 días = 123,000 → 23 % sobre 100,000.
    expect(view.platforms[0]!.projection).toMatchObject({ projected: 123000, daysLeft: 20, monthBudget: 100000, status: "over" });
    expect(view.platforms[0]!.projection!.neededDaily).toBeCloseTo((100000 - 40000 - 3000) / 20);
    expect(view.platforms[0]!.insights[0]!.text).toMatch(/cerraría el mes en \$123,000, 23% sobre.*el diario debería ser \$2,850 \(hoy \$4,000\)/);
  });
  it("el total suma solo plataformas con presupuesto leído; sin presupuesto mensual no hay lectura", () => {
    const view = buildBudgetOverview(
      input(
        [budget({ platform: "meta", campaign_id: "1", campaign_name: "Venta", daily_budget: 3000 }), budget({ platform: "google", campaign_id: "g", campaign_name: "Search", daily_budget: 1500 })],
        { month, budgetThresholds: { overspendAttention: 0.05, underspendAttention: 0.1 } },
      ),
    );
    expect(view.projection).toMatchObject({ monthBudget: 150000, projected: 60000 + 4500 + 4500 * 20, status: "on" });
    const noBudget = buildBudgetOverview(
      input([budget({ platform: "meta", campaign_id: "1", campaign_name: "Venta" })], { month: { ...month, lines: { meta: { budget: null, spend: 5 } } } }),
    );
    expect(noBudget.platforms[0]!.projection).toMatchObject({ monthBudget: null, vsBudget: null, neededDaily: null, status: null });
  });
});
