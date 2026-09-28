import { describe, expect, it } from "vitest";
import { classify, unreachableRules } from "@/lib/classifiers/classify";
import { GOOGLE_CLASSIFIER, META_CLASSIFIER } from "@/lib/classifiers/defaults";

const meta = (campaign: string, secondary = "") => classify(META_CLASSIFIER, { campaign, secondary }).label;
const google = (campaign: string, secondary = "") => classify(GOOGLE_CLASSIFIER, { campaign, secondary }).label;

describe("clasificador de Meta (réplica de la fórmula de la hoja)", () => {
  it("respeta el orden de las reglas", () => {
    expect(meta("ABCW | Negocios | Pymes", "OUTCOME_LEADS")).toBe("Negocios"); // Negocios va antes que LEAD
    expect(meta("ABCW | CAPI WHATSAPP | Nacional")).toBe("CAPI WhatsApp"); // antes que "WhatsApp"
    expect(meta("Paquetes | Sitio Web | Venta")).toBe("Web"); // "Sitio Web" antes que "Venta"
    expect(meta("Exponente | Venta | Ofertas")).toBe("Venta");
    expect(meta("Paquetes | SALES | Salesforce Leads", "OUTCOME_LEADS")).toBe("Sales Force"); // SALES antes que LEAD
  });
  it("usa el campo secundario (columna D) para LEAD", () => {
    expect(meta("MXN 1 | Formulario | FTTH", "OUTCOME_LEADS")).toBe("Formulario");
    expect(meta("MXN 1 | Formulario | FTTH", "OUTCOME_AWARENESS")).toBe("Branding");
  });
  it("distingue las reglas de móvil y marca", () => {
    expect(meta("Universal+ | Performance 2024 | Móvil")).toBe("Formulario móvil");
    expect(meta("MXN 2 | Performance | Móvil | Formulario")).toBe("Formulario móvil");
    expect(meta("izzi Telecom | móvil | Branding")).toBe("Branding móvil");
    expect(meta("Universal+ | Brand 100% l Digital")).toBe("Branding 100% Digital");
    expect(meta("MXN 5 | Temporal | Septiembre")).toBe("Branding - Temporales");
    expect(meta("MXN 5 | Performance 2024 | Nuevos Artes | Hogar")).toBe("WhatsApp o Messenger");
    expect(meta("MXN 4 | Llamada | Nacional")).toBe("Llamadas");
    expect(meta("MXN 3 | Auronix | Bot")).toBe("Auronix");
  });
  it("como HALLAR: sin distinguir mayúsculas pero sí acentos; respaldo Branding", () => {
    expect(meta("campaña whatsapp nacional")).toBe("WhatsApp o Messenger");
    expect(meta("Exponente | Hogar | Alcance")).toBe("Branding");
    expect(meta("Performance | Movil sin acento")).toBe("Branding");
  });
  it("detecta la regla repetida que nunca se aplica", () => {
    expect(unreachableRules(META_CLASSIFIER)).toEqual([{ index: 16, shadowedBy: 5 }]);
  });
});

describe("clasificador de Google (réplica de la fórmula de la hoja)", () => {
  it("clasifica búsquedas por nombre de campaña", () => {
    expect(google("Search | Genéricas Maradona | Nacional")).toBe("SEARCH MARADONA");
    expect(google("Search | Genéricas | Internet Hogar")).toBe("SEARCH GENÉRICA");
    expect(google("Genéricas (NUEVO) Test AI Max Génerica")).toBe("SEARCH GENÉRICA");
    expect(google("Marca Maradona")).toBe("SEARCH MARADONA");
    expect(google("Search | Negocios | Llamadas 800")).toBe("SEARCH NEGOCIOS");
    expect(google("Search | Competencia | Nacional")).toBe("SEARCH COMPETENCIA");
  });
  it("Performance Max y Demand Gen", () => {
    expect(google("izzi móvil PMAX", "PERFORMANCE_MAX")).toBe("PERFORMANCE_MAX");
    expect(google("izzi móvil DEMAND GEN", "DEMAND_GEN")).toBe("DEMAND GEN");
  });
  it("sin coincidencia usa la columna L (tipo de campaña)", () => {
    expect(google("Performance Max | 2026 | Genericas Ofertas", "PERFORMANCE_MAX")).toBe("PERFORMANCE_MAX"); // "Genericas" sin acento no coincide con "gené"
    expect(google("MXSUR - CPC Manual", "SEARCH")).toBe("SEARCH");
    expect(google("MXSUR - CPC Manual", "")).toBe("Sin clasificar");
  });
  it("detecta la regla repetida que nunca se aplica", () => {
    expect(unreachableRules(GOOGLE_CLASSIFIER)).toEqual([{ index: 8, shadowedBy: 3 }]);
  });
});
