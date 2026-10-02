import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DomainSummaryCopy } from "@/components/absolute-top/domain-summary-copy";
import { AbsoluteTopDashboardView } from "@/components/absolute-top/dashboard";
import { absoluteTopViewSnapshot } from "./absolute-top-view-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
describe("manual domain summary controls", () => {
  it("provides a named copy button and keyboard-accessible labeled text without external requests", () => {
    const fixture = absoluteTopViewSnapshot();
    const html = renderToStaticMarkup(createElement(DomainSummaryCopy, { summary: fixture.summaries[0], rows: fixture.rows }));
    expect(html).toContain('aria-label="Copiar resumen de Dominio de prueba"');
    expect(html).toContain('aria-label="Ver resumen manual de Dominio de prueba"');
    expect(html).toContain("Resumen manual de Dominio de prueba");
    expect(html).toMatch(/<textarea[^>]*readOnly=""/i);
    expect(html).toContain("min-h-11");
    expect(html).toContain("min-w-0");
    expect(html).toContain("role=\"status\"");
    expect(html).toContain("Grupos de anuncios: 1 analizadas");
    expect(html).not.toContain('type="submit"');
  });
  it("integrates the complete domain snapshot with its card, keeping the affected group in copied text", () => {
    const html = renderToStaticMarkup(createElement(AbsoluteTopDashboardView, { initial: absoluteTopViewSnapshot() }));
    expect(html).toContain("Copiar resumen");
    expect(html).toContain("Internet 350 MB → Search | Paquetes");
    expect(html).toContain("Campañas: 1 analizadas · 1 cumplen");
    expect(html).toContain("Grupos de anuncios: 1 analizadas · 0 cumplen · 0 cerca · 1 fuera");
  });
  it("escapes supplied names while retaining an explicit empty-data summary", () => {
    const fixture = absoluteTopViewSnapshot();
    const html = renderToStaticMarkup(createElement(DomainSummaryCopy, { summary: { ...fixture.summaries[0], domain_name: '<script>alert("fixture")</script>' }, rows: [] }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("no significa cumplimiento");
    expect(html).toContain("Cobertura por entidad: N/D");
  });
});
