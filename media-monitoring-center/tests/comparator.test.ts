import { describe, expect, it } from "vitest";
import { OBJECTIVE_KPI } from "@/lib/metrics";
import { compareWindow, windowTotals } from "@/lib/monitoring/historical-comparator";
import { flatSeries } from "./helpers";

describe("comparador histórico: mismo día + misma franja", () => {
  // Hoy lunes 12:00 Meta gastó 800k (ventana 00–12); lunes anteriores 1.1M, 1.2M, 1.15M, 1.15M en la misma franja.
  const series = flatSeries({
    "2026-09-28": { spend: 1_600_000, conversions: 1600 },
    "2026-09-21": { spend: 2_200_000, conversions: 2000 },
    "2026-09-14": { spend: 2_400_000, conversions: 2400 },
    "2026-09-07": { spend: 2_300_000, conversions: 2300 },
    "2026-08-31": { spend: 2_300_000, conversions: 2300 },
  });
  const res = compareWindow({
    series,
    date: "2026-09-28",
    referenceDates: ["2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31"],
    fromHour: 0,
    toHour: 12,
    kpi: OBJECTIVE_KPI.CONVERSIONS,
    baseline: "mean",
    minSamples: 2,
  });

  it("calcula actual, semana anterior, promedio y mediana de la misma ventana", () => {
    expect(res.spend!.current).toBeCloseTo(800_000);
    expect(res.spend!.prevWeek).toBeCloseTo(1_100_000);
    expect(res.spend!.mean).toBeCloseTo(1_150_000);
    expect(res.spend!.median).toBeCloseTo(1_150_000);
    expect(res.spend!.deltaVsPrevWeek).toBeCloseTo(-0.2727, 3);
    expect(res.spend!.deltaVsMean).toBeCloseTo(-0.3043, 3);
  });

  it("CPA = SUMA(costo) ÷ SUMA(conversiones), nunca promedio de CPAs", () => {
    // Esperado = 1,150,000 / 1,125 conversiones (promedio de totales), no el promedio de los CPA semanales.
    expect(res.cpa!.expected).toBeCloseTo(1_150_000 / 1125, 6);
    expect(res.cpa!.current).toBeCloseTo(1000, 6);
  });

  it("NULL no es cero: una semana sin datos se excluye de la referencia", () => {
    const s = flatSeries({ "2026-09-28": { spend: 100 }, "2026-09-21": { spend: 100 }, "2026-09-14": { spend: 100 } });
    const r = compareWindow({ series: s, date: "2026-09-28", referenceDates: ["2026-09-21", "2026-09-14", "2026-09-07"], fromHour: 0, toHour: 24, kpi: OBJECTIVE_KPI.CONVERSIONS, baseline: "mean", minSamples: 2 });
    expect(r.spend!.sampleCount).toBe(2);
    expect(r.spend!.mean).toBeCloseTo(100);
    expect(r.conversions!.current).toBeNull();
    expect(windowTotals(s, "2026-09-07", 0, 24)).toBeNull();
  });

  it("con muestras insuficientes no hay valor esperado (no se inventa)", () => {
    const s = flatSeries({ "2026-09-28": { spend: 100 }, "2026-09-21": { spend: 100 } });
    const r = compareWindow({ series: s, date: "2026-09-28", referenceDates: ["2026-09-21", "2026-09-14"], fromHour: 0, toHour: 24, kpi: OBJECTIVE_KPI.CONVERSIONS, baseline: "mean", minSamples: 2 });
    expect(r.spend!.expected).toBeNull();
  });
});
