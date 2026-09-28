import { describe, expect, it } from "vitest";
import { addDays, businessDate, sameWeekdayDates, weekdayOf, zonedParts, zonedTimeToUtc } from "@/lib/time/tz";

const TZ = "America/Mexico_City";

describe("zona horaria de negocio", () => {
  it("convierte fecha/hora local a UTC y de regreso (CDMX = UTC-6)", () => {
    const utc = zonedTimeToUtc("2026-09-28", 12, 0, TZ);
    expect(utc.toISOString()).toBe("2026-09-28T18:00:00.000Z");
    expect(businessDate(utc, TZ)).toBe("2026-09-28");
    expect(zonedParts(utc, TZ).hour).toBe(12);
  });

  it("la fecha de negocio no es la fecha UTC cerca de medianoche", () => {
    const late = new Date("2026-09-29T03:30:00Z"); // 21:30 del 28 en CDMX
    expect(businessDate(late, TZ)).toBe("2026-09-28");
  });

  it("mismo día de la semana en las semanas anteriores (lunes vs lunes)", () => {
    expect(weekdayOf("2026-09-28")).toBe(1);
    const refs = sameWeekdayDates("2026-09-28", 4);
    expect(refs).toEqual(["2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31"]);
    expect(refs.every((d) => weekdayOf(d) === 1)).toBe(true);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
