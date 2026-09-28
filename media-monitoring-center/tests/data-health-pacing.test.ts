import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { evaluateFreshness } from "@/lib/monitoring/data-health";
import { buildHourlyCurve, dailyPacing, monthlyPacing, shareAtCutoff } from "@/lib/monitoring/pacing-engine";
import { zonedTimeToUtc } from "@/lib/time/tz";
import type { FreshnessRecord } from "@/lib/types";
import { emptyMetrics } from "@/lib/metrics";
import type { HourlySeries } from "@/lib/monitoring/historical-comparator";

const TZ = "America/Mexico_City";
const at = (h: number, m: number) => zonedTimeToUtc("2026-09-28", h, m, TZ);
const rec = (last: Date | null, status: FreshnessRecord["lastSyncStatus"] = "SUCCESS"): FreshnessRecord => ({
  platform: "meta",
  accountId: null,
  lastDataAt: last ? last.toISOString() : null,
  lastSyncAt: null,
  lastSyncStatus: status,
  lastError: status === "FAILED" ? "401 token vencido" : null,
});

describe("DATA HEALTH: 0 ≠ NULL ≠ DATA DELAYED ≠ ERROR", () => {
  it("datos al día; un dato a las 11:54 cubre el corte de 12:00", () => {
    const f = evaluateFreshness(rec(at(11, 54)), at(12, 5), DEFAULT_SETTINGS);
    expect(f.state).toBe("OK");
    expect(f.coveredUntilHour).toBe(12);
  });

  it("sin datos desde hace 3 horas → DATA DELAYED (no gasto $0)", () => {
    const f = evaluateFreshness(rec(at(9, 0)), at(12, 5), DEFAULT_SETTINGS);
    expect(f.state).toBe("DELAYED");
    expect(f.lagMinutes).toBe(185);
  });

  it("sincronización fallida → ERROR", () => {
    expect(evaluateFreshness(rec(at(10, 30), "FAILED"), at(12, 5), DEFAULT_SETTINGS).state).toBe("ERROR");
  });

  it("nunca recibió datos → NO_DATA", () => {
    expect(evaluateFreshness(rec(null), at(12, 5), DEFAULT_SETTINGS).state).toBe("NO_DATA");
  });
});

describe("PacingEngine con curva horaria histórica", () => {
  // Curva: la mitad del gasto ocurre en las primeras 6 horas (no lineal).
  const day = (): Array<ReturnType<typeof emptyMetrics>> =>
    Array.from({ length: 24 }, (_, h) => ({ ...emptyMetrics(), spend: h < 6 ? 500 / 6 : 500 / 18 }));
  const series: HourlySeries = new Map([
    ["2026-09-21", day()],
    ["2026-09-14", day()],
  ]);

  it("usa la curva histórica y no la lineal", () => {
    const curve = buildHourlyCurve(series, ["2026-09-21", "2026-09-14"]);
    expect(curve.source).toBe("historical");
    expect(shareAtCutoff(curve, 6)).toBeCloseTo(0.5, 5);
    const p = dailyPacing({ spend: 400, cutoffHour: 6, curve, dailyBudget: 1000 });
    expect(p.expectedByCurve).toBeCloseTo(500, 5);
    expect(p.deviation).toBeCloseTo(-0.2, 5);
    expect(p.forecastClose).toBeCloseTo(800, 5);
  });

  it("sin histórico suficiente cae a curva lineal", () => {
    const curve = buildHourlyCurve(new Map(), []);
    expect(curve.source).toBe("linear");
    expect(shareAtCutoff(curve, 12)).toBeCloseTo(0.5, 5);
  });

  it("pacing mensual: usado, esperado, varianza y forecast de cierre", () => {
    const m = monthlyPacing({
      budget: 30_000,
      monthToDateSpend: 15_500,
      todaySpend: 500,
      todayForecast: 1000,
      elapsedFullDays: 15,
      todayShare: 0.5,
      daysInMonth: 30,
      weekdayAverages: [1000, 1000, 1000, 1000, 1000, 1000, 1000],
      remainingWeekdays: Array.from({ length: 14 }, (_, i) => i % 7),
    });
    expect(m.usedPct).toBeCloseTo(15_500 / 30_000, 6);
    expect(m.expectedPct).toBeCloseTo(15.5 / 30, 6);
    expect(m.forecast).toBeCloseTo(15_500 + 500 + 14_000, 6);
    expect(m.remaining).toBe(14_500);
  });
});
