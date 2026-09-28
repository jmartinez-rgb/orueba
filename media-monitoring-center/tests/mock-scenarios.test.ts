import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { MockDataSource } from "@/lib/mock/mock-source";
import { runMonitoring } from "@/lib/monitoring/monitoring-engine";
import { zonedTimeToUtc } from "@/lib/time/tz";

const TZ = "America/Mexico_City";

async function statusAt(scenarioId: string, date = "2026-09-28", hour = 12) {
  const src = new MockDataSource({ scenarioId, timezone: TZ, referenceTime: zonedTimeToUtc(date, hour, 20, TZ).toISOString() });
  return runMonitoring(src, { settings: DEFAULT_SETTINGS, asOf: src.now() });
}

describe("MOCK MODE · escenario demo", () => {
  it("Google 🟢 · Meta 🔴 · TikTok 🟢 · Microsoft 🟡 · Spotify 🟢 · X 🟢", async () => {
    const run = await statusAt("default");
    const s = Object.fromEntries(Object.values(run.platformStatus).map((p) => [p.platform, p.severity]));
    expect(s).toEqual({ google: "NORMAL", meta: "CRITICAL", tiktok: "NORMAL", microsoft: "ATTENTION", spotify: "NORMAL", x: "NORMAL" });
    expect(run.overall).toBe("CRITICAL");
    const types = run.anomalies.map((a) => `${a.key}:${a.type}`);
    expect(types).toContain("platform:meta:PLATFORM_INCIDENT");
    expect(types).toContain("campaign:meta:m-2007:DELIVERY_CRITICAL");
    expect(types).toContain("campaign:meta:m-2006:TRACKING_ISSUE");
    expect(types).toContain("account:microsoft:b-402:DATA_ISSUE");
  }, 30000);

  it("la cuenta atrasada se excluye de la comparación de su plataforma (PARTIAL)", async () => {
    const run = await statusAt("default");
    const ms = run.entities.find((e) => e.key === "platform:microsoft")!;
    expect(ms.dataState).toBe("PARTIAL");
    expect(ms.excludedAccounts).toContain("b-402");
  }, 30000);

  it("es estable en distintas horas del día", async () => {
    for (const h of [9, 15, 21]) {
      const run = await statusAt("default", "2026-09-28", h);
      expect(run.platformStatus.meta.severity).toBe("CRITICAL");
      expect(run.platformStatus.google.severity).toBe("NORMAL");
      expect(run.platformStatus.microsoft.severity).toBe("ATTENTION");
    }
  }, 60000);
});

describe("MOCK MODE · otros escenarios", () => {
  it("todo normal: sin falsas alarmas", async () => {
    const run = await statusAt("normal");
    expect(run.overall).toBe("NORMAL");
    expect(run.anomalies.filter((a) => a.level !== "campaign")).toHaveLength(0);
  }, 30000);

  it("Meta sin datos: DATA DELAYED, sin anomalías de performance", async () => {
    const run = await statusAt("meta-delayed");
    expect(run.platformStatus.meta.dataState).toBe("DELAYED");
    const meta = run.anomalies.filter((a) => a.platform === "meta");
    expect(meta.every((a) => a.type === "DATA_ISSUE")).toBe(true);
    expect(run.platformStatus.x.dataState).toBe("ERROR");
    expect(run.totalIncludes).not.toContain("meta");
  }, 30000);

  it("TikTok dejó de gastar con datos al día: DELIVERY CRITICAL", async () => {
    const run = await statusAt("tiktok-stopped");
    expect(run.platformStatus.tiktok.severity).toBe("CRITICAL");
    expect(run.anomalies.some((a) => a.key === "platform:tiktok" && a.type === "DELIVERY_CRITICAL")).toBe(true);
  }, 30000);
});
