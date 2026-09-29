import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { detectAnomalies } from "@/lib/anomaly-engine/anomaly-engine";
import { sustainedLevel } from "@/lib/monitoring/sustained";
import type { EntityEvaluation } from "@/lib/monitoring/types";
import { evaluation } from "./helpers";

const ctx = { settings: DEFAULT_SETTINGS, cutoffHour: 12 };
const one = (e: EntityEvaluation) => detectAnomalies([e], ctx);

describe("resultados que llegan con retraso (conversiones offline)", () => {
  it("conversiones en cero con gasto normal no son tracking si la métrica llega con retraso", () => {
    const base = evaluation({ spend: [98_000, 100_000], result: [0, 60] });
    expect(one(base)[0].type).toBe("TRACKING_ISSUE");
    expect(one({ ...base, resultLagging: true })).toHaveLength(0);
  });

  it("con retraso solo se juzga el gasto: caída de gasto = bajo delivery, sin citar resultados", () => {
    const [a] = one({ ...evaluation({ spend: [60_000, 100_000], result: [100, 500] }), resultLagging: true });
    expect(a.type).toBe("UNDERSPEND");
    expect(a.severity).toBe("ALERT");
    expect(a.adjustments.join(" ")).toContain("llegan con retraso");
  });
});

describe("curva horaria estimada (la hoja solo trae el acumulado del día)", () => {
  it("las alertas que dependen del esperado a esta hora bajan un nivel", () => {
    const base = evaluation({ spend: [50_000, 100_000], result: [250, 500] });
    expect(one(base)[0].severity).toBe("CRITICAL");
    const [a] = one({ ...base, curveEstimated: true });
    expect(a.type).toBe("DELIVERY_ISSUE");
    expect(a.severity).toBe("ALERT");
    expect(a.adjustments.join(" ")).toContain("curva típica");
  });

  it("no declara 'dejó de gastar' con la ventana reciente repartida por la curva", () => {
    const base = evaluation({ spend: [85_000, 100_000], result: [430, 500], recentSpend: [0, 20_000] });
    expect(one(base)[0].type).toBe("DELIVERY_CRITICAL");
    expect(one({ ...base, curveEstimated: true }).some((a) => a.type === "DELIVERY_CRITICAL")).toBe(false);
  });

  it("gasto en cero sigue siendo crítico aunque la curva sea estimada", () => {
    const [a] = one({ ...evaluation({ spend: [0, 60_000], result: [0, 40] }), curveEstimated: true });
    expect(a.type).toBe("DELIVERY_CRITICAL");
    expect(a.severity).toBe("CRITICAL");
  });

  it("costo por resultado: la severidad sale del costo, no del gasto vs esperado", () => {
    // Gasto +60% vs esperado (depende de la curva) y costo por resultado +20% (no depende).
    const base = evaluation({ spend: [160_000, 100_000], result: [667, 500] });
    expect(one(base)[0].severity).toBe("CRITICAL");
    const [a] = one({ ...base, curveEstimated: true });
    expect(a.type).toBe("EFFICIENCY_ISSUE");
    expect(a.severity).toBe("ATTENTION");
  });
});

describe("cambio sostenido de gasto", () => {
  const down = { ratio: 0.16, days: 3, direction: "down" as const };

  it("si hoy sigue en el nivel de los últimos días, baja a ATENCIÓN y lo explica", () => {
    const [a] = one({ ...evaluation({ spend: [16_000, 100_000], result: [80, 500] }), sustained: down });
    expect(a.severity).toBe("ATTENTION");
    expect(a.adjustments.join(" ")).toContain("parece un cambio de presupuesto");
  });

  it("si hoy cae además contra ese nivel, conserva la severidad de lo que cambió hoy", () => {
    const [a] = one({ ...evaluation({ spend: [4_000, 100_000], result: [20, 500] }), sustained: down });
    expect(a.severity).toBe("CRITICAL");
    expect(a.adjustments.join(" ")).toContain("-75.0% contra ese nivel");
  });

  it("'dejó de gastar' se mide contra el nivel nuevo", () => {
    const base = evaluation({ spend: [16_000, 100_000], result: [80, 500], recentSpend: [800, 20_000] });
    expect(one(base)[0].type).toBe("DELIVERY_CRITICAL");
    const out = one({ ...base, sustained: down });
    expect(out.some((a) => a.type === "DELIVERY_CRITICAL")).toBe(false);
    expect(out[0].severity).toBe("ATTENTION");
  });

  it("detecta el nivel nuevo con los días completos recientes vs el mismo día de semanas anteriores", () => {
    // Del 2026-09-01 al 2026-09-22 gastaba ~150k diarios; desde el 26 gasta ~25k.
    const spend = (d: string) => (d >= "2026-09-26" ? 25_000 : 150_000);
    const lvl = sustainedLevel({ date: "2026-09-29", days: 3, weeks: 4, baseline: "mean", minSamples: 2, threshold: 0.15, valueOn: spend });
    expect(lvl?.direction).toBe("down");
    expect(lvl?.ratio).toBeCloseTo(25_000 / 150_000, 3);
  });

  it("un solo día distinto no es cambio sostenido", () => {
    const spend = (d: string) => (d === "2026-09-28" ? 25_000 : 150_000);
    expect(sustainedLevel({ date: "2026-09-29", days: 3, weeks: 4, baseline: "mean", minSamples: 2, threshold: 0.15, valueOn: spend })).toBeNull();
  });

  it("sin histórico suficiente no se declara", () => {
    const spend = (d: string) => (d >= "2026-09-20" ? 25_000 : null);
    expect(sustainedLevel({ date: "2026-09-29", days: 3, weeks: 4, baseline: "mean", minSamples: 2, threshold: 0.15, valueOn: spend })).toBeNull();
  });
});
