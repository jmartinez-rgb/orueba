import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FeedbackForm, FeedbackStatusField } from "@/components/feedback/feedback-center";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const attributes = (markup: string) => Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const props = { sections: [{ href: "/campaigns", label: "Campañas" }, { href: "/", label: "Resumen" }], initialPage: "/campaigns" };

it("associates both feedback selectors and text inputs with visible labels and the privacy instruction", () => {
  const markup = renderToStaticMarkup(createElement(FeedbackForm, props));
  const labels = new Map([...markup.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)].map(match => [attributes(match[1]).for, match[2]]));
  const selectors = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => attributes(match[0])).filter(button => button.role === "combobox");
  expect(selectors.map(select => labels.get(select.id))).toEqual(["Sección", "Impacto"]);
  const input = [...markup.matchAll(/<input\b[^>]*>/g)].map(match => attributes(match[0])).find(element => element.type !== "hidden");
  expect(labels.get(input!.id)).toBe("¿Qué falla?");
  const textarea = attributes(markup.match(/<textarea\b[^>]*>/)![0]);
  expect(labels.get(textarea.id)).toBe("¿Qué hiciste, qué esperabas y qué pasó?");
  const privacy = [...markup.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].find(match => attributes(match[1]).id === textarea["aria-describedby"]);
  expect(privacy?.[2]).toBe("No incluyas contraseñas ni datos personales.");
});

it("does not reuse field IDs when two feedback forms render on the same page", () => {
  const markup = renderToStaticMarkup(createElement(Fragment, null, createElement(FeedbackForm, props), createElement(FeedbackForm, props)));
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  expect(ids.length).toBeGreaterThan(8);
  expect(new Set(ids).size).toBe(ids.length);
  for (const label of markup.matchAll(/<label\b([^>]*)>/g)) expect(ids).toContain(attributes(label[1]).for);
});

it("names the expanded-case status selector and gives separate instances unique label associations even for the same report", () => {
  const field = () => createElement(FeedbackStatusField, { reportId: "FB-001", value: "EN_REVISION", onChange: () => undefined });
  const markup = renderToStaticMarkup(createElement(Fragment, null, field(), field()));
  const labels = new Map([...markup.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)].map(match => [attributes(match[1]).for, match[2]]));
  const selectors = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => attributes(match[0])).filter(button => button.role === "combobox");
  expect(selectors).toHaveLength(2);
  expect(new Set(selectors.map(select => select.id)).size).toBe(2);
  for (const select of selectors) {
    expect(labels.get(select.id)).toBe("Estado");
    expect(select["aria-label"]).toBe("Estado del reporte FB-001");
  }
});
