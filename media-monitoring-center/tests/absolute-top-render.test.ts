import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AbsoluteTopDashboardView, DomainCard, EntityState, StructureTree } from "@/components/absolute-top/dashboard";
import { EntityDetails } from "@/components/absolute-top/entity-details";
import { absoluteTopViewRow, absoluteTopViewSnapshot } from "./absolute-top-view-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("Absolute Top dashboard rendering", () => {
  it("keeps the red child prominent when its parent and domain aggregate meet their targets", () => {
    const snapshot = absoluteTopViewSnapshot();
    const html = renderToStaticMarkup(createElement(AbsoluteTopDashboardView, { initial: snapshot }));
    expect(html).toContain("73.0%");
    expect(html).toContain("entidades fuera del objetivo permanecen visibles");
    expect(html).toContain("Internet 350 MB");
    expect(html).toContain("Fuera del objetivo");
    const firstRow = html.match(/<tbody[^>]*><tr[^>]*>(.*?)<\/tr>/s)?.[1];
    expect(firstRow).toContain("Internet 350 MB");
    expect(html).toContain("indicador aproximado");
    expect(html).toContain("sin sumar otra vez sus grupos");
  });
  it("does not classify a missing audit as healthy and explains that opening the page is read-only", () => {
    const snapshot = absoluteTopViewSnapshot();
    snapshot.available = false; snapshot.rows = []; snapshot.summaries = []; snapshot.lastAuditAt = null;
    const html = renderToStaticMarkup(createElement(AbsoluteTopDashboardView, { initial: snapshot }));
    expect(html).toContain("Sin auditorías de Absolute Top almacenadas");
    expect(html).toContain("No significa que las campañas cumplan");
    expect(html).toContain("Abrir el dashboard no extrae datos ni modifica Google Ads");
    expect(html).not.toContain("Estructura dentro del objetivo");
  });
  it("renders missing central configuration and partial data warnings explicitly", () => {
    const snapshot = absoluteTopViewSnapshot();
    snapshot.configured = false; snapshot.policy = null; snapshot.warnings = ["Cobertura parcial: falta un grupo de anuncios."]; snapshot.rows[1].coverage = "partial";
    const html = renderToStaticMarkup(createElement(AbsoluteTopDashboardView, { initial: snapshot }));
    expect(html).toContain("Configuración maestra de dominios no disponible");
    expect(html).toContain("Cobertura parcial");
    expect(html).toContain("falta un grupo de anuncios");
  });
  it("uses targets and names supplied by the central DTO rather than hardcoded identifiers or rules", () => {
    const summary = { ...absoluteTopViewSnapshot().summaries[0], domain_name: "Nuevo dominio central", target_rate: 0.42 };
    const html = renderToStaticMarkup(createElement(DomainCard, { summary }));
    expect(html).toContain("Nuevo dominio central");
    expect(html).toContain("Objetivo mínimo 42.0%");
    expect(html).not.toContain("70.0%");
  });
  it("preserves unknown metrics, bounded IS values and native currency while showing every required detail", () => {
    const row = absoluteTopViewRow({ absolute_top_rate: null, state: "insufficient", gap_pp: null, source_timezone: "America/Mexico_City", currency: "USD", ctr: 1.5, search_impression_share: null, search_lost_is_rank: null, search_lost_is_budget: null, share_bounds: { search_impression_share: "lt_10_percent", search_lost_is_rank: "gt_90_percent" } });
    const html = renderToStaticMarkup(createElement(EntityDetails, { row }));
    expect(html).toContain("N/D");
    expect(html).toContain("&lt;10%");
    expect(html).toContain("&gt;90%");
    expect(html).toContain("USD");
    expect(html).toContain("1.5%");
    expect(html).toContain("America/Mexico_City");
    for (const label of ["Comparativas temporales", "Auditoría anterior", "Mismo periodo del día anterior", "Últimas 24 horas", "Últimos 7 días", "Persistencia", "Evolución", "Peor valor", "Mejor valor"]) expect(html).toContain(label);
    expect(html).toContain("no se envía a WhatsApp ni Slack");
  });
  it("shows a preventive decline without replacing an independently supplied meets state", () => {
    const row = absoluteTopViewRow({ state: "meets", sudden_drop: true, comparison: { ...absoluteTopViewRow().comparison, previous: { rate: 0.82, delta_pp: -9, approximate: false, samples: 1 } } });
    const badge = renderToStaticMarkup(createElement(EntityState, { row }));
    expect(badge).toContain("Cumple");
    expect(badge).toContain("Deterioro");
    const details = renderToStaticMarkup(createElement(EntityDetails, { row }));
    expect(details).toContain("Deterioro preventivo");
    expect(details).toContain("−9.0 pp");
  });
  it("shows parent context and affected child count even when a local filter leaves only the red child", () => {
    const snapshot = absoluteTopViewSnapshot();
    const html = renderToStaticMarkup(createElement(StructureTree, { rows: [snapshot.rows[1]], allRows: snapshot.rows }));
    expect(html).toContain("Dominio de prueba");
    expect(html).toContain("Cuenta de prueba");
    expect(html).toContain("Search | Paquetes");
    expect(html).toContain("Internet 350 MB");
    expect(html).toContain("Cumple");
    expect(html).toContain("1 grupos fuera del objetivo");
    expect(html).toContain("Problema localizado");
  });
  it("provides labeled keyboard-native filters, a table caption and accessible trend fallback", () => {
    const html = renderToStaticMarkup(createElement(AbsoluteTopDashboardView, { initial: absoluteTopViewSnapshot() }));
    expect((html.match(/<select /g) ?? []).length).toBe(6);
    expect(html).toContain("<caption");
    expect(html).toContain("aria-controls=\"absolute-top-details\"");
    expect(html).toContain("Ver mediciones de la evolución");
    expect(html).toContain("role=\"img\"");
  });
});
