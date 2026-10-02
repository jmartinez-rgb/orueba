import { describe, expect, it } from "vitest";
import { buildAbsoluteTopDomainText } from "@/lib/absolute-top/domain-format";
import { absoluteTopViewRow, absoluteTopViewSnapshot } from "./absolute-top-view-fixtures";

describe("manual Absolute Top domain summary", () => {
  it("separates campaigns from groups and keeps the red group visible under a favorable aggregate", () => {
    const fixture = absoluteTopViewSnapshot();
    const result = buildAbsoluteTopDomainText(fixture.summaries[0], fixture.rows);
    expect(result).toContain("Campañas: 1 analizadas · 1 cumplen · 0 cerca · 0 fuera");
    expect(result).toContain("Grupos de anuncios: 1 analizadas · 0 cumplen · 0 cerca · 1 fuera");
    expect(result).toContain("Abs. Top ponderado del dominio: 73.0%");
    expect(result).toContain("no se vuelven a sumar sus grupos");
    expect(result).toContain("Internet 350 MB → Search | Paquetes");
    expect(result).toContain("Abs. Top 45.0% · objetivo 70.0% · brecha -25.0 pp · prioridad 90.0/100");
    expect(result).toContain("No envía mensajes a WhatsApp ni Slack");
  });
  it("quotes near and insufficient states with their coverage and N/D metrics", () => {
    const fixture = absoluteTopViewSnapshot();
    fixture.rows[0] = absoluteTopViewRow({ state: "near", absolute_top_rate: 0.68, gap_pp: -2 });
    fixture.rows[1] = { ...fixture.rows[1], state: "insufficient", coverage: "partial", absolute_top_rate: null, gap_pp: null };
    const result = buildAbsoluteTopDomainText(fixture.summaries[0], fixture.rows);
    expect(result).toContain("1 analizadas · 0 cumplen · 1 cerca · 0 fuera");
    expect(result).toContain("1 analizadas · 0 cumplen · 0 cerca · 0 fuera · 1 insuficientes/sin clasificar");
    expect(result).toContain("Cobertura por entidad: 1 completa · 1 parcial · 0 no disponible");
    expect(result).toContain("Métrica Absolute Top N/D: 1 entidades");
    expect(result).toContain("cobertura parcial");
  });
  it("uses only rows from the requested domain, with names and targets supplied by its DTO", () => {
    const fixture = absoluteTopViewSnapshot();
    const result = buildAbsoluteTopDomainText({ ...fixture.summaries[0], domain_name: "Cuarto dominio", target_rate: 0.42 }, [...fixture.rows, absoluteTopViewRow({ domain_id: "foreign", campaign_name: "Foreign secret campaign" })]);
    expect(result).toContain("Cuarto dominio");
    expect(result).toContain("Objetivo mínimo del dominio: 42.0%");
    expect(result).not.toContain("Foreign secret campaign");
    expect(result).toContain("Campañas: 1 analizadas");
  });
  it("does not describe an empty audit as healthy or display unsubstantiated aggregate values", () => {
    const result = buildAbsoluteTopDomainText(absoluteTopViewSnapshot().summaries[0], []);
    expect(result).toContain("no significa cumplimiento");
    expect(result).toContain("Cobertura por entidad: N/D");
    expect(result).toContain("Abs. Top ponderado del dominio: N/D");
    expect(result).toContain("Cumplimiento entre entidades evaluables del resumen: N/D");
    expect(result).not.toContain("73.0%");
  });
  it("keeps accounts with homonymous campaign IDs distinct and describes each audit instant", () => {
    const fixture = absoluteTopViewSnapshot();
    const second = absoluteTopViewRow({ entity_key: "2345678901:campaign:456", customer_id: "2345678901", account_id: "2345678901", account_name: "Segunda cuenta", audit_id: "audit-2", audit_at: "2026-10-02T16:00:00Z" });
    const result = buildAbsoluteTopDomainText({ ...fixture.summaries[0], campaigns: 2 }, [...fixture.rows, second]);
    expect(result).toContain("Campañas: 2 analizadas");
    expect(result).toContain("Cuenta de prueba (1234567890)");
    expect(result).toContain("Segunda cuenta (2345678901)");
    expect(result).toContain("auditoría audit-1 · 2026-10-02T15:00:00.000Z");
    expect(result).toContain("auditoría audit-2 · 2026-10-02T16:00:00.000Z");
    expect(result).toContain("incluso si comparten la fecha final del reporte");
    expect(result).toContain("no confirma una medición simultánea");
  });
  it("makes incompatible periods and cuts explicit instead of presenting one common percentage", () => {
    const fixture = absoluteTopViewSnapshot();
    fixture.rows.push(absoluteTopViewRow({ entity_key: "2345678901:campaign:456", customer_id: "2345678901", account_id: "2345678901", window_from: "2026-09-30", window_to: "2026-10-01", window_end_hour: 7 }));
    fixture.summaries[0].campaigns = 2;
    const result = buildAbsoluteTopDomainText(fixture.summaries[0], fixture.rows);
    expect(result).toContain("2026-09-30 a 2026-10-01 · acumulado [00:00, 08:00)");
    expect(result).toContain("America/Mexico_City");
    expect(result).toContain("Hay ventanas o cortes distintos");
    expect(result).toContain("Abs. Top ponderado del dominio: N/D");
    expect(result).toContain("Las campañas no corresponden a una ventana común");
    expect(result).not.toContain("Abs. Top ponderado del dominio: 73.0%");
  });
  it("does not silently reuse a larger summary's percentages for a subset of entities", () => {
    const fixture = absoluteTopViewSnapshot();
    const result = buildAbsoluteTopDomainText(fixture.summaries[0], [fixture.rows[0]]);
    expect(result).toContain("El detalle no coincide con el alcance del resumen agregado");
    expect(result).toContain("Grupos de anuncios: 0 analizadas");
    expect(result).toContain("Abs. Top ponderado del dominio: N/D");
  });
  it("bounds principal affectations per level and preserves the full counts", () => {
    const fixture = absoluteTopViewSnapshot();
    const campaigns = Array.from({ length: 7 }, (_, index) => absoluteTopViewRow({ entity_key: `1234567890:campaign:${index}`, campaign_id: String(index), campaign_name: `Affected ${index}`, state: "below", severity_score: index * 10, absolute_top_rate: 0.4, gap_pp: -30 }));
    const result = buildAbsoluteTopDomainText({ ...fixture.summaries[0], campaigns: 7, ad_groups: 0 }, campaigns);
    expect(result).toContain("7 analizadas · 0 cumplen · 0 cerca · 7 fuera");
    expect(result).toContain("Se muestran 5 de 7 afectaciones de este nivel");
    expect(result.indexOf("- Affected 6")).toBeLessThan(result.indexOf("- Affected 5"));
    expect(result).not.toContain("- Affected 0");
    expect(result).not.toContain("- Affected 1");
  });
  it("reports a preventive decline without changing the stored meets state", () => {
    const fixture = absoluteTopViewSnapshot();
    fixture.rows[0] = { ...fixture.rows[0], sudden_drop: true, severity_score: 65 };
    const result = buildAbsoluteTopDomainText(fixture.summaries[0], fixture.rows);
    expect(result).toContain("Campañas: 1 analizadas · 1 cumplen");
    expect(result).toContain("Cumple · deterioro preventivo");
  });
  it("keeps invalid numerical values N/D and does not mutate stored evaluations", () => {
    const fixture = absoluteTopViewSnapshot();
    fixture.rows[1] = { ...fixture.rows[1], absolute_top_rate: Infinity, gap_pp: NaN, severity_score: Infinity };
    const before = structuredClone(fixture.rows);
    const result = buildAbsoluteTopDomainText(fixture.summaries[0], fixture.rows);
    expect(result).toContain("Abs. Top N/D · objetivo 70.0% · brecha N/D · prioridad N/D");
    expect(result).not.toMatch(/NaN|Infinity/);
    expect(fixture.rows).toEqual(before);
  });
});
