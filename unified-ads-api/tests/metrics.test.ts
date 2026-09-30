import { describe, expect, it } from "vitest";
import {
  cpa,
  cpc,
  cpm,
  ctr,
  derivedMetrics,
  microsToCurrency,
  round,
  safeDivide,
} from "../src/normalization/metrics.js";

describe("fórmulas normalizadas", () => {
  it("CTR = clics / impresiones × 100", () => {
    expect(ctr(50, 1000)).toBe(5);
  });
  it("CPC = gasto / clics", () => {
    expect(cpc(250, 50)).toBe(5);
  });
  it("CPM = gasto / impresiones × 1000", () => {
    expect(cpm(250, 50_000)).toBe(5);
  });
  it("CPA = gasto / conversiones", () => {
    expect(cpa(1000, 8)).toBe(125);
  });

  it("nunca NaN ni Infinity: división por cero, nulos o valores no finitos dan null", () => {
    for (const f of [ctr, cpc, cpm, cpa]) {
      expect(f(10, 0)).toBeNull();
      expect(f(null, 10)).toBeNull();
      expect(f(10, null)).toBeNull();
      expect(f(Number.NaN, 10)).toBeNull();
      expect(f(10, Number.POSITIVE_INFINITY)).toBeNull();
      expect(f(undefined, 10)).toBeNull();
    }
    expect(safeDivide(0, 5)).toBe(0);
    expect(safeDivide(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull();
  });

  it("métricas derivadas redondeadas", () => {
    expect(derivedMetrics({ spend: 100, impressions: 3000, clicks: 30, conversions: 3 })).toEqual({
      ctr: 1,
      cpc: 3.3333,
      cpm: 33.3333,
      cpa: 33.3333,
    });
    expect(derivedMetrics({ spend: null, impressions: 0, clicks: 0, conversions: 0 })).toEqual({
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
    });
    expect(round(0.1 + 0.2)).toBe(0.3);
  });

  it("micros de Google a moneda", () => {
    expect(microsToCurrency(1_234_560_000)).toBe(1234.56);
    expect(microsToCurrency("2500000")).toBe(2.5);
    expect(microsToCurrency(null)).toBeNull();
    expect(microsToCurrency("abc")).toBeNull();
  });
});
