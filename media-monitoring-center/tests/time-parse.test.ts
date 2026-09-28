import { describe, expect, it } from "vitest";
import { parseDateTimeLoose } from "@/lib/time/parse";

const TZ = "America/Mexico_City"; // UTC-6 todo el año (sin horario de verano desde 2022)

describe("fecha de última ejecución (hoja o tabla de control)", () => {
  it("formato de México en la zona de negocio, no en la del servidor", () => {
    expect(parseDateTimeLoose("28/09/2026 10:05:00", TZ)).toBe("2026-09-28T16:05:00.000Z");
    expect(parseDateTimeLoose("28/09/2026 10:05 p. m.", TZ)).toBe("2026-09-29T04:05:00.000Z");
    expect(parseDateTimeLoose("12/09/2026 12:30 a. m.", TZ)).toBe("2026-09-12T06:30:00.000Z");
    expect(parseDateTimeLoose("09/28/2026 10:05", TZ)).toBe("2026-09-28T16:05:00.000Z"); // mes/día si el segundo número pasa de 12
  });
  it("ISO con y sin zona (Apps Script y BigQuery)", () => {
    expect(parseDateTimeLoose("2026-09-28 10:05", TZ)).toBe("2026-09-28T16:05:00.000Z");
    expect(parseDateTimeLoose("2026-09-28 16:05:00+00", TZ)).toBe("2026-09-28T16:05:00.000Z");
    expect(parseDateTimeLoose("2026-09-28 16:05:00.250+00", TZ)).toBe("2026-09-28T16:05:00.250Z");
    expect(parseDateTimeLoose("2026-09-28T10:05:00-0600", TZ)).toBe("2026-09-28T16:05:00.000Z");
    expect(parseDateTimeLoose("2026-09-28T16:05:00.000Z", TZ)).toBe("2026-09-28T16:05:00.000Z");
    expect(parseDateTimeLoose({ value: "2026-09-28T16:05:00.000Z" }, TZ)).toBe("2026-09-28T16:05:00.000Z");
  });
  it("número de serie de Google Sheets", () => {
    expect(parseDateTimeLoose(45658.5, TZ)).toBe("2025-01-01T18:00:00.000Z");
    expect(parseDateTimeLoose("45658.75", TZ)).toBe("2025-01-02T00:00:00.000Z");
  });
  it("lo que no reconoce queda NULL (nunca inventa una hora)", () => {
    for (const v of ["ayer", "31/02/2026", "2026-13-01", "", "120", null, undefined, "28/09/2026 25:00"]) expect(parseDateTimeLoose(v, TZ)).toBeNull();
  });
});
