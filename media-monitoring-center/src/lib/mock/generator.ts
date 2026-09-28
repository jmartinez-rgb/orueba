import type { BaseMetric, PlatformId } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { addDays, businessDate, weekdayOf, zonedParts, zonedTimeToUtc } from "@/lib/time/tz";
import { MOCK_CAMPAIGNS, DELIVERY_PROFILE, REVENUE_PER_SALE, type MockCampaignSeed } from "./catalog";
import { DAILY_TREND, DOW_COST, DOW_SPEND, HOURLY_SHARE } from "./curves";
import { hashString, mulberry32, noiseFactory } from "./prng";
import type { MockScenario, ScenarioEffect } from "./scenarios";

/**
 * Generador del histórico simulado: 15 semanas de datos horarios por campaña.
 * Se guarda en arreglos tipados (NaN = NULL / sin fila) para que sea ligero en memoria.
 */

export const MOCK_HISTORY_DAYS = 7 * 15;

export type MetricSeries = Record<BaseMetric, Float64Array>;

export interface MockDataset {
  scenario: MockScenario;
  timezone: string;
  generatedFor: Date;
  today: string;
  startDate: string;
  days: number;
  /** Hora local actual: las horas < currentHour de hoy están completas. */
  currentHour: number;
  series: Map<string, MetricSeries>;
  /** Instante (ms) en que cada cuenta/plataforma dejó de enviar datos. */
  stopTimes: Array<{ platform: PlatformId; accountId?: string; stopMs: number }>;
}

const RESULT_KEYS: BaseMetric[] = ["leads", "sales", "whatsapp", "calls", "purchases"];

function effectApplies(e: ScenarioEffect, c: MockCampaignSeed, dayOffset: number, hour: number, currentHour: number) {
  if (e.dayOffset !== dayOffset) return false;
  if (e.platform && e.platform !== c.platform) return false;
  if (e.accountId && e.accountId !== c.accountId) return false;
  if (e.campaignIds && !e.campaignIds.includes(c.id)) return false;
  if (e.excludeCampaignIds && e.excludeCampaignIds.includes(c.id)) return false;
  if (e.lastHours !== undefined) {
    return hour >= currentHour - e.lastHours && hour < currentHour;
  }
  const from = e.fromHour ?? 0;
  const to = e.toHour ?? 24;
  return hour >= from && hour < to;
}

export function generateDataset(scenario: MockScenario, now: Date, timezone: string): MockDataset {
  const today = businessDate(now, timezone);
  const currentHour = zonedParts(now, timezone).hour;
  const days = MOCK_HISTORY_DAYS + 1;
  const startDate = addDays(today, -MOCK_HISTORY_DAYS);
  const nowMs = now.getTime();

  const stopTimes = scenario.outages.map((o) => ({
    platform: o.platform,
    accountId: o.accountId,
    stopMs: nowMs - o.stoppedMinutesAgo * 60000,
  }));

  // Fin de cada hora (UTC ms) para los últimos 2 días: sirve para cortar datos por atrasos.
  const hourEnds = new Map<string, number>();
  for (const d of [addDays(today, -1), today]) {
    for (let h = 0; h < 24; h++) hourEnds.set(`${d}|${h}`, zonedTimeToUtc(d, h, 0, timezone).getTime() + 3600000);
  }

  const series = new Map<string, MetricSeries>();

  for (const c of MOCK_CAMPAIGNS) {
    const size = days * 24;
    const s = Object.fromEntries(BASE_METRICS.map((m) => [m, new Float64Array(size).fill(Number.NaN)])) as MetricSeries;
    series.set(c.id, s);
    if (c.status !== "ACTIVE" || c.dailySpend <= 0) continue;

    const platform = PLATFORMS[c.platform];
    const supported = new Set(platform.supportedMetrics);
    const share = HOURLY_SHARE[c.platform];
    const profile = DELIVERY_PROFILE[c.platform];
    const stops = stopTimes.filter((st) => st.platform === c.platform && (!st.accountId || st.accountId === c.accountId));

    for (let d = 0; d < days; d++) {
      const date = addDays(startDate, d);
      const dayOffset = d - (days - 1);
      const wd = weekdayOf(date);
      const rand = mulberry32(hashString(`${c.id}|${date}`));
      const noise = noiseFactory(rand);
      const dayNoise = noise(0.03);
      const dayCost = noise(0.02);
      const base = c.dailySpend * DOW_SPEND[wd] * (1 + DAILY_TREND * dayOffset);

      for (let h = 0; h < 24; h++) {
        const hourNoise = noise(0.05);
        const convNoise = noise(0.05);
        const imprNoise = noise(0.04);
        const clickNoise = noise(0.05);
        if (dayOffset === 0 && h >= currentHour) continue; // hora aún no transcurre
        if (dayOffset >= -1 && stops.length > 0) {
          const end = hourEnds.get(`${date}|${h}`) ?? 0;
          // Fuente atrasada: no hay fila (un dato recibido hasta 15 min antes del cierre cuenta la hora).
          if (stops.some((st) => end > st.stopMs + 15 * 60000) && end <= nowMs) continue;
        }

        let spendFactor = 1;
        let resultFactor = 1;
        const zero = new Set<BaseMetric>();
        for (const e of scenario.effects) {
          if (!effectApplies(e, c, dayOffset, h, currentHour)) continue;
          if (e.spend !== undefined) spendFactor *= Array.isArray(e.spend) ? e.spend[h] : e.spend;
          if (e.results !== undefined) resultFactor *= e.results;
          e.zeroResults?.forEach((m) => zero.add(m));
        }

        const idx = d * 24 + h;
        const spend = base * share[h] * dayNoise * hourNoise * spendFactor;
        s.spend[idx] = Math.round(spend * 100) / 100;
        const impressions = (spend / profile.cpm) * 1000 * imprNoise;
        s.impressions[idx] = Math.round(impressions);
        s.clicks[idx] = Math.round(impressions * profile.ctr * clickNoise);

        const costFactor = DOW_COST[wd] * dayCost * convNoise;
        let convSum = 0;
        let convHasValue = false;
        for (const m of RESULT_KEYS) {
          if (!supported.has(m)) continue;
          const cost = c.costs[m];
          if (cost === null) continue; // NULL: la métrica no se reporta
          let v = cost === undefined ? 0 : spend / (cost * costFactor);
          v *= resultFactor;
          if (zero.has(m)) v = 0;
          s[m][idx] = Math.round(v);
          convSum += s[m][idx];
          convHasValue = true;
        }
        if (supported.has("conversions")) {
          const cc = c.costs.conversions;
          if (cc === null) {
            // NULL: la campaña no tiene conversión configurada.
          } else if (zero.has("conversions")) {
            s.conversions[idx] = 0;
          } else if (cc !== undefined) {
            s.conversions[idx] = Math.round((spend / (cc * costFactor)) * resultFactor);
          } else if (convHasValue) {
            s.conversions[idx] = Math.round(convSum - (s.whatsapp[idx] || 0));
          } else {
            s.conversions[idx] = 0;
          }
        }
        if (supported.has("revenue")) {
          const sales = (Number.isNaN(s.sales[idx]) ? 0 : s.sales[idx]) + (Number.isNaN(s.purchases[idx]) ? 0 : s.purchases[idx]);
          s.revenue[idx] = sales * REVENUE_PER_SALE;
        }
      }
    }
  }

  return { scenario, timezone, generatedFor: now, today, startDate, days, currentHour, series, stopTimes };
}
