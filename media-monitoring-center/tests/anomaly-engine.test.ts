import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { detectAnomalies, platformImpactSeverity } from "@/lib/anomaly-engine/anomaly-engine";
import { classifyDeviation } from "@/lib/anomaly-engine/severity";
import { evaluation } from "./helpers";

const ctx = { settings: DEFAULT_SETTINGS, cutoffHour: 12 };
const one = (e: ReturnType<typeof evaluation>) => detectAnomalies([e], ctx);

describe("semáforos configurables", () => {
  it("<15% normal, 15–25 atención, 25–40 alerta, >40 crítico", () => {
    const t = DEFAULT_SETTINGS.thresholds;
    expect(classifyDeviation(0.1, t)).toBe("NORMAL");
    expect(classifyDeviation(0.2, t)).toBe("ATTENTION");
    expect(classifyDeviation(0.3, t)).toBe("ALERT");
    expect(classifyDeviation(0.45, t)).toBe("CRITICAL");
  });
});

describe("reglas de patrón", () => {
  it("CASO 1: gasto ↓ y resultados ↓ → DELIVERY ISSUE", () => {
    const [a] = one(evaluation({ spend: [66_000, 100_000], result: [300, 500] }));
    expect(a.type).toBe("DELIVERY_ISSUE");
    expect(a.severity).toBe("ALERT"); // max(34%, 40%) → alerta (40% no es "mayor a 40")
  });

  it("CASO 2: gasto normal y resultados ↓ → PERFORMANCE ISSUE (o TRACKING si el tráfico no cae y la caída es severa)", () => {
    const [p] = one(evaluation({ spend: [100_000, 100_000], result: [400, 500], clicks: [9_000, 10_000] }));
    expect(p.type).toBe("PERFORMANCE_ISSUE");
    const [t] = one(evaluation({ spend: [100_000, 100_000], result: [250, 500], clicks: [10_000, 10_000] }));
    expect(t.type).toBe("TRACKING_ISSUE");
  });

  it("CASO 3: gasto ↑ sin resultados proporcionales → EFFICIENCY ISSUE", () => {
    const [a] = one(evaluation({ spend: [140_000, 100_000], result: [500, 500] }));
    expect(a.type).toBe("EFFICIENCY_ISSUE");
  });

  it("gasto ↑ con resultados que acompañan → SOBREINVERSIÓN", () => {
    const [a] = one(evaluation({ spend: [135_000, 100_000], result: [670, 500] }));
    expect(a.type).toBe("OVERSPEND");
  });

  it("CASO 4: campaña activa con gasto 0 → DELIVERY CRITICAL", () => {
    const [a] = one(evaluation({ spend: [0, 60_000], result: [0, 40] }));
    expect(a.type).toBe("DELIVERY_CRITICAL");
    expect(a.severity).toBe("CRITICAL");
  });

  it("CASO 5: varias campañas caen a la vez → PLATFORM INCIDENT y las campañas se agrupan", () => {
    const camps = [1, 2, 3, 4].map((i) => evaluation({ key: `campaign:meta:c${i}`, spend: [60_000, 100_000], result: [300, 500], share: 0.2 }));
    const platform = evaluation({ level: "platform", key: "platform:meta", spend: [300_000, 400_000], result: [1700, 2000], share: 1 });
    const out = detectAnomalies([platform, ...camps], ctx);
    const inc = out.find((a) => a.level === "platform")!;
    expect(inc.type).toBe("PLATFORM_INCIDENT");
    const children = out.filter((a) => a.level === "campaign");
    expect(children).toHaveLength(4);
    expect(children.every((c) => c.groupedUnder === inc.fingerprint)).toBe(true);
    expect(children.every((c) => platformImpactSeverity(c, DEFAULT_SETTINGS) === "NORMAL")).toBe(true);
  });

  it("CASO 6: gasto normal y conversiones = 0 → TRACKING ISSUE crítico", () => {
    const [a] = one(evaluation({ spend: [98_000, 100_000], result: [0, 60] }));
    expect(a.type).toBe("TRACKING_ISSUE");
    expect(a.severity).toBe("CRITICAL");
  });

  it("CASO 7: sin datos recientes → DATA ISSUE, nunca caída de performance", () => {
    const out = one(evaluation({ spend: [10_000, 100_000], result: [10, 500], dataState: "DELAYED" }));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("DATA_ISSUE");
  });

  it("dejó de gastar en la ventana reciente → DELIVERY CRITICAL aunque el acumulado caiga poco", () => {
    const [a] = one(evaluation({ spend: [85_000, 100_000], result: [430, 500], recentSpend: [0, 20_000] }));
    expect(a.type).toBe("DELIVERY_CRITICAL");
  });
});

describe("no solo porcentajes", () => {
  it("volumen irrelevante: una campaña diminuta no genera alerta", () => {
    expect(one(evaluation({ spend: [1_000, 3_000], result: [1, 5] }))).toHaveLength(0);
  });

  it("variación de conteos dentro del ruido estadístico no alerta", () => {
    // 30 vs 35 esperados: −14%… y aun con −20% (28 vs 35) está dentro de ±2·√35.
    expect(one(evaluation({ spend: [100_000, 100_000], result: [28, 35] }))).toHaveLength(0);
  });

  it("horas tempranas: la severidad baja un nivel", () => {
    const [a] = one(evaluation({ spend: [66_000, 100_000], result: [320, 500], cutoffHour: 6 }));
    expect(a.severity).toBe("ATTENTION");
    expect(a.adjustments.join(" ")).toMatch(/Pocas horas/);
  });

  it("una campaña pequeña no pinta de rojo toda su plataforma", () => {
    const [a] = one(evaluation({ spend: [0, 60_000], result: [0, 40], share: 0.05 }));
    expect(a.severity).toBe("CRITICAL");
    expect(platformImpactSeverity(a, DEFAULT_SETTINGS)).toBe("ATTENTION");
  });
});
