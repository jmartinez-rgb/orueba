import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { detectAnomalies } from "@/lib/anomaly-engine/anomaly-engine";
import { sustainedLevel } from "@/lib/monitoring/sustained";
import type { EntityEvaluation } from "@/lib/monitoring/types";
import { learnCurves, synthesizeHourly, type SheetRecord } from "@/lib/sheets/transform";
import { emptyMetrics } from "@/lib/metrics";
import { HOURLY_SHARE } from "@/lib/mock/curves";
import { explainGoogleError } from "@/lib/google/errors";
import { friendlyError } from "@/lib/logging/logger";
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

describe("curva aprendida de una semana de datos por hora", () => {
  const rec = (date: string, hour: number | null, spend: number, accountId = "acc-1", shape: "daily" | "hourly" = "hourly"): SheetRecord => ({
    sheet: shape === "hourly" ? "Meta | Hora" : "Meta",
    platform: "meta",
    shape,
    level: shape === "hourly" ? "account" : "campaign",
    date,
    hour,
    accountId,
    accountName: null,
    campaignId: shape === "daily" ? "c-1" : null,
    campaignName: null,
    campaignStatus: null,
    campaignType: null,
    objective: null,
    currency: null,
    metrics: { ...emptyMetrics(), spend },
  });
  // Cuenta que gasta todo por la tarde (12:00–23:59), muy distinto a la curva genérica.
  const afternoonDay = (date: string) => Array.from({ length: 24 }, (_, h) => rec(date, h, h >= 12 ? 100 : 0));
  const hourly = new Map(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-29"].map((d) => [d, afternoonDay(d)]));

  it("aprende la curva de cada cuenta con al menos 3 días completos (sin contar hoy)", () => {
    const learned = learnCurves(hourly, "2026-09-29");
    const acc = learned.accounts.get("acc-1")!;
    expect(acc.slice(0, 12).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
    expect(acc.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(learnCurves(new Map([...hourly].slice(0, 2)), "2026-09-29").accounts.size).toBe(0);
  });

  it("reparte un día sin datos por hora con la curva aprendida, no con la genérica", () => {
    const learned = learnCurves(hourly, "2026-09-29");
    const { rows, estimated } = synthesizeHourly({
      platform: "meta",
      date: "2026-09-01",
      daily: [rec("2026-09-01", null, 1200, "acc-1", "daily")],
      hourlyAccount: [],
      coverHours: null,
      defaultCurve: HOURLY_SHARE.meta,
      learned,
    });
    expect(estimated).toBe(false);
    const morning = rows.filter((r) => r.hour < 12).reduce((a, r) => a + (r.metrics.spend ?? 0), 0);
    expect(morning).toBeCloseTo(0, 6);
    expect(rows.reduce((a, r) => a + (r.metrics.spend ?? 0), 0)).toBeCloseTo(1200, 6);
  });
});

describe("errores de Google explicados", () => {
  it("llave borrada, hoja sin compartir, API apagada, ID equivocado y llave mal copiada", () => {
    expect(explainGoogleError("Error: invalid_grant: Invalid JWT Signature.")).toContain("ya no es válida");
    expect(explainGoogleError("Google Sheets respondió 403. The caller does not have permission")).toContain("no está compartida");
    expect(explainGoogleError("403 PERMISSION_DENIED Google Sheets API has not been used in project 707 before or it is disabled")).toContain("no está habilitada");
    expect(explainGoogleError("Google Sheets respondió 404. Requested entity was not found.")).toContain("No existe una hoja");
    expect(explainGoogleError("error:1E08010C:DECODER routines::unsupported")).toContain("mal copiada");
    expect(explainGoogleError("algo raro")).toBeNull();
  });
  it("el mensaje para el usuario incluye la causa y el arreglo", () => {
    const f = friendlyError("sheets", new Error("invalid_grant: Invalid JWT Signature."));
    expect(f.message).toContain("No pudimos leer la hoja de Google Sheets.");
    expect(f.message).toContain("npm run sheets:setup");
  });
});
