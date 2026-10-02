import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusHero } from "@/components/monitoring/status-hero";
import type { PlatformCardVM } from "@/lib/services/view-models";
import type { PlatformId } from "@/lib/types";

function summary(cards: Partial<Record<PlatformId, Partial<PlatformCardVM>>>) {
  return renderToStaticMarkup(createElement(StatusHero, {
    overall: "NORMAL", cards: cards as Record<PlatformId, PlatformCardVM>, openIncidents: 0, activeAlerts: 0,
  }));
}

describe("resumen visual y ausencia de datos", () => {
  it("no anuncia todo en orden si no hay plataformas evaluadas", () => {
    const html = summary({});
    expect(html).toContain("Sin plataformas para evaluar");
    expect(html).toContain("Evaluación pendiente");
    expect(html).not.toContain("Todo en orden");
  });
  it("no interpreta una fuente sin datos como rendimiento normal", () => {
    const html = summary({ google: { severity: "NORMAL", dataState: "NO_DATA", dataReason: "Fuente sin muestras" } });
    expect(html).toContain("Datos pendientes de evaluación");
    expect(html).toContain("sin datos evaluables");
    expect(html).not.toContain("Todo en orden");
  });
  it("distingue la fuente atrasada del rendimiento evaluado de otra plataforma", () => {
    const html = summary({ google: { severity: "NORMAL", dataState: "OK" }, meta: { severity: "NORMAL", dataState: "DELAYED", dataReason: "Actualización pendiente" } });
    expect(html).toContain("1 de 2 plataformas con rendimiento evaluable");
    expect(html).not.toContain("Todo en orden");
  });
  it("conserva el mensaje normal cuando todas las plataformas tienen datos evaluables", () => {
    const html = summary({ google: { severity: "NORMAL", dataState: "OK" } });
    expect(html).toContain("Todo en orden");
    expect(html).not.toContain("Evaluación pendiente");
  });
});
