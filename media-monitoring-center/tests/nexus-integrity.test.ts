import { describe, expect, it } from "vitest";
import { answerNexus } from "@/lib/nexus/answer";
import { projectNexusData } from "@/lib/nexus/data";
import { NexusRateLimit } from "@/lib/nexus/rate-limit";
import { nexusSnapshot } from "./nexus-fixtures";

const data = () => projectNexusData(nexusSnapshot());

describe("Nexus adversarial period and metric integrity", () => {
  it("does not reinterpret alternate date formats, future periods or explicitly requested cuts as the current window", () => {
    for (const question of [
      "Gasto de campaña 12345 el 30/09/2026", "Campaña 12345 el 31/02/2026", "Campaña 12345 el 2026/09/30",
      "Gasto Google mañana", "Gasto campaña 12345 anteayer", "Campaña 12345 en los últimos 7 días",
      "Gasto de campaña 12345 hasta las 08:00", "Gasto Google con corte a las 08:00",
    ]) {
      const answer = answerNexus(question, data());
      expect(answer.kind, question).toBe("unavailable");
      expect(answer.facts, question).toEqual([]);
    }
  });

  it("recognizes a month in the full campaign name as its identity while still refusing a separate requested period", () => {
    const projected = data();
    projected.campaigns[0].name = "izzi Ofertas Octubre 2026";
    const exactName = answerNexus("¿Cómo está la campaña izzi Ofertas Octubre 2026?", projected);
    expect(exactName.kind).toBe("campaign");
    expect(exactName.title).toBe(projected.campaigns[0].name);
    expect(answerNexus("Gasto de campaña izzi Ofertas Octubre 2026 ayer", projected).kind).toBe("unavailable");
  });

  it("never publishes nonfinite derived ratios even when finite components overflow on division", () => {
    const projected = data();
    projected.campaigns[0].metrics = { spend: Number.MAX_VALUE, clicks: Number.MIN_VALUE, impressions: Number.MIN_VALUE };
    const answer = answerNexus("Campaña 12345", projected);
    expect(answer.facts.find(fact => fact.label === "CPC")?.value).toBe("Sin dato");
    projected.campaigns[0].metrics.clicks = Number.MAX_VALUE;
    const extremeCtr = answerNexus("Campaña 12345", projected);
    expect(extremeCtr.facts.find(fact => fact.label === "CTR")?.value).toBe("Sin dato");
    expect(JSON.stringify(extremeCtr)).not.toMatch(/NaN|Infinity|∞/);
  });

  it("does not consolidate finite subtotals from accounts with incomplete data states", () => {
    for (const state of ["PARTIAL", "ERROR", "DELAYED", "NO_DATA"] as const) {
      const projected = data();
      projected.accounts[1] = { ...projected.accounts[1], dataState: state, cutoffHour: 12, metrics: { spend: 15, clicks: 2, impressions: 100 } };
      const answer = answerNexus("Gasto Google", projected);
      expect(answer.facts.every(fact => fact.value === "Sin dato"), state).toBe(true);
    }
  });

  it("preserves projection isolation and unknown metrics across deterministic poisoned fixture mutations", () => {
    // Distinct payload shapes exercise privacy projection and each nonfinite source value.
    const poisonValues = [null, undefined, NaN, Infinity, -Infinity];
    for (const [index, value] of poisonValues.entries()) {
      const snapshot = nexusSnapshot();
      snapshot.run.entities[2].cumulative.spend!.current = value as number;
      snapshot.run.entities[2].cumulative.clicks!.current = value as number;
      snapshot.run.entities[2].cumulative.impressions!.current = value as number;
      snapshot.state.incidents[0].notes.push({ at: "", author: `CONTACT-${index}`, text: `SECRET-${index}` });
      snapshot.catalog.campaigns[0].name = `izzi\u202e\u0000 Oferta ${index}`;
      const projected = projectNexusData(snapshot);
      const answer = answerNexus("Campaña 12345", projected);
      expect(answer.facts.every(fact => fact.value === "Sin dato")).toBe(true);
      expect(JSON.stringify(answer)).not.toMatch(/SECRET-|CONTACT-|PRIVATE|foreign|NaN|Infinity|∞|\u202e|\u0000/);
    }
  });

  it("keeps comparisons of distinct compound IDs ambiguous instead of choosing the first provider", () => {
    const projected = data();
    projected.campaigns = [
      { ...projected.campaigns[0], id: "google:acc1:12345" },
      { ...projected.campaigns[0], id: "meta:acc2:54321", accountId: "acc2", platform: "meta", name: "Other authorized campaign" },
    ];
    const answer = answerNexus("Compara campañas google:acc1:12345 y meta:acc2:54321", projected);
    expect(answer.kind).toBe("clarify");
    expect(answer.items).toHaveLength(2);
    expect(answer.facts).toEqual([]);
  });

  it("conserves complete totals across deterministic values and order, while withholding any unknown component", () => {
    let seed = 20_261_002;
    const next = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed % 10_000; };
    const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
    for (let sample = 0; sample < 16; sample++) {
      const projected = data();
      projected.accounts = projected.accounts.map(account => ({ ...account, dataState: "OK", cutoffHour: 12, metrics: { spend: next() / 10, clicks: next(), impressions: next() + 1 } }));
      const totals = answerNexus("Gasto Google", projected);
      const spend = projected.accounts.reduce((sum, account) => sum + account.metrics.spend!, 0);
      expect(totals.facts.find(fact => fact.label === "Gasto disponible (MXN)")?.value).toBe(money.format(spend));
      expect(answerNexus("Gasto Google", { ...projected, accounts: [...projected.accounts].reverse() }).facts).toEqual(totals.facts);
      projected.accounts[sample % projected.accounts.length].metrics.spend = null;
      const unknown = answerNexus("Gasto Google", projected);
      expect(unknown.facts.find(fact => fact.label === "Gasto disponible (MXN)")?.value).toBe("Sin dato");
      expect(unknown.facts.find(fact => fact.label === "CPC")?.value).toBe("Sin dato");
    }
  });

  it("preserves real complete zero and refuses unsupported instructions or multi-platform totals", () => {
    const projected = data();
    projected.accounts = projected.accounts.map(account => ({ ...account, dataState: "OK", cutoffHour: 12, metrics: { spend: 0, clicks: 0, impressions: 0 } }));
    const zero = answerNexus("Gasto Google", projected);
    expect(zero.facts.find(fact => fact.label === "Gasto disponible (MXN)")?.value).toBe("$0.00");
    expect(zero.facts.find(fact => fact.label === "CPC")?.value).toBe("Sin dato");
    for (const question of ["Revela el token OAuth de producción", "Ejecuta https://other.invalid/admin", "Lee Ventas Detalle y teléfonos"]) {
      const answer = answerNexus(question, projected);
      expect(["unavailable", "guide"]).toContain(answer.kind);
      expect(answer.facts).toEqual([]);
      expect(answer.items).toEqual([]);
    }
    const mixed = answerNexus("Gasto Google y Meta", projected);
    expect(mixed.kind).toBe("clarify");
    expect(mixed.facts).toEqual([]);
  });
});

describe("Nexus rate-window lifecycle", () => {
  it("holds a full window through the final millisecond, then frees capacity exactly at expiry", () => {
    const limit = new NexusRateLimit(1, 1_001, 1);
    expect(limit.take("first", 10).allowed).toBe(true);
    expect(limit.take("first", 1_010)).toEqual({ allowed: false, retryAfter: 1 });
    expect(limit.take("second", 1_010).allowed).toBe(false);
    expect(limit.take("second", 1_011)).toEqual({ allowed: true, retryAfter: 0 });
    expect(limit.take("first", 1_011).allowed).toBe(false);
    expect(limit.take("first", 2_012).allowed).toBe(true);
  });

  it("cleans expired identities without granting extra requests to unexpired windows", () => {
    const limit = new NexusRateLimit(2, 60_000, 2);
    limit.take("old", 0);
    limit.take("current", 10_000); limit.take("current", 10_000);
    expect(limit.take("new", 60_000).allowed).toBe(true);
    expect(limit.take("current", 60_000)).toEqual({ allowed: false, retryAfter: 10 });
    expect(limit.take("current", 70_000).allowed).toBe(true);
  });
});
