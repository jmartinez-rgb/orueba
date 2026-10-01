import { describe, expect, it } from "vitest";
import { demoPreviousSnapshot, detectBudgetChanges, type BudgetSnapshot } from "@/lib/services/budget-changes";

const snap = (date: string, units: Record<string, number>): BudgetSnapshot => ({
  date,
  at: `${date}T18:00:00.000Z`,
  units: Object.fromEntries(Object.entries(units).map(([k, daily]) => [k, { platform: "meta", name: k, strategy: "Venta", daily }])),
});

describe("cambios de presupuesto entre días", () => {
  it("detecta subidas, bajadas, nuevas y las que dejaron de tener presupuesto, con el umbral del equipo", () => {
    const prev = snap("2026-09-30", { a: 1000, b: 1000, c: 1000, d: 500 });
    const now = snap("2026-10-01", { a: 1300, b: 700, c: 1100, e: 2000 });
    const r = detectBudgetChanges(prev, now, 0.15);
    expect(r.changes.map((c) => [c.key, c.kind, c.delta])).toEqual([
      ["e", "new", 2000],
      ["d", "gone", -500],
      ["a", "up", 300],
      ["b", "down", -300],
    ]);
    // c subió 10 %: debajo del umbral de atención, no se reporta.
    expect(r).toMatchObject({ since: "2026-09-30", net: 1500, counts: { up: 1, down: 1, new: 1, gone: 1 } });
    expect(r.changes.find((c) => c.key === "a")!.pct).toBeCloseTo(0.3);
  });

  it("la foto de ejemplo del modo demo produce cambios de cada tipo", () => {
    const now = snap("2026-10-01", { a: 1300, b: 1000, c: 800, d: 400 });
    const r = detectBudgetChanges(demoPreviousSnapshot(now, "2026-09-30"), now, 0.15);
    expect(r.counts).toEqual({ up: 1, down: 1, new: 1, gone: 1 });
  });
});
