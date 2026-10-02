import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsForm } from "@/components/monitoring/settings-form";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function props(canEdit = true) {
  return {
    initial: {
      ...DEFAULT_SETTINGS,
      recipients: [
        { id: "recipient-one", name: "Equipo uno", channel: "email" as const, address: "one@example.test", minSeverity: "ALERT" as const, platforms: "all" as const, active: true },
        { id: "recipient-two", name: "Equipo dos", channel: "email" as const, address: "two@example.test", minSeverity: "ALERT" as const, platforms: "all" as const, active: true },
      ],
    },
    revision: "test-revision", canEdit, mode: "unified" as const,
    campaigns: [{ id: "google:account:campaign-one", name: "Ofertas", platform: "google" as const, objective: "TRAFFIC" as const }],
  };
}

const attributes = (markup: string) => Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const labels = (markup: string) => new Map([...markup.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)].map(match => [attributes(match[1]).for, match[2].replace(/<[^>]+>/g, "")]));

describe("Settings accessible control relationships", () => {
  it("gives every numeric field a unique label relationship and preserves its rendered configuration value", () => {
    const markup = renderToStaticMarkup(createElement(SettingsForm, props()));
    const names = labels(markup);
    const numbers = [...markup.matchAll(/<input\b[^>]*>/g)].map(match => attributes(match[0])).filter(input => input.type === "number");
    expect(numbers.length).toBeGreaterThan(20);
    expect(new Set(numbers.map(input => input.id)).size).toBe(numbers.length);
    for (const input of numbers) expect(names.get(input.id)?.trim(), `Numeric input ${input.value}`).toBeTruthy();
    const thresholdId = [...names].find(([, name]) => name.includes("Atención desde"))?.[0];
    expect(numbers.find(input => input.id === thresholdId)?.value).toBe(String(DEFAULT_SETTINGS.thresholds.attention * 100));
  });

  it("associates numeric units and explanatory hints with their own field instead of neighboring controls", () => {
    const markup = renderToStaticMarkup(createElement(SettingsForm, props()));
    const names = labels(markup);
    const id = [...names].find(([, name]) => name === "Tolerancia de hora completa")?.[0];
    const input = [...markup.matchAll(/<input\b[^>]*>/g)].map(match => attributes(match[0])).find(element => element.id === id);
    const references = input?.["aria-describedby"].split(" ") ?? [];
    expect(references).toHaveLength(2);
    const described = references.map(reference => [...markup.matchAll(/<(span|p)\b([^>]*)>([\s\S]*?)<\/\1>/g)].find(match => attributes(match[2]).id === reference)?.[3]);
    expect(described).toContain("min");
    expect(described).toContain("Un dato a las 11:54 cuenta como corte 12:00.");
  });

  it("names baseline, timezone, severity, recipient and campaign selectors, including repeated recipient rows", () => {
    const markup = renderToStaticMarkup(createElement(SettingsForm, props()));
    const names = labels(markup);
    const selects = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => attributes(match[0])).filter(button => button.role === "combobox");
    expect(selects.length).toBeGreaterThanOrEqual(10);
    for (const select of selects) expect((select["aria-label"] || names.get(select.id))?.trim()).toBeTruthy();
    expect(selects.filter(select => select["aria-label"]?.startsWith("Canal del destinatario")).map(select => select["aria-label"])).toEqual(["Canal del destinatario 1", "Canal del destinatario 2"]);
    expect(selects.some(select => select["aria-label"] === "Objetivo asignado a Ofertas (google:account:campaign-one)")).toBe(true);
  });

  it("keeps associations unique across two instances and preserves disabled read-only numeric controls", () => {
    const markup = renderToStaticMarkup(createElement(Fragment, null, createElement(SettingsForm, props()), createElement(SettingsForm, props(false))));
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const names = labels(markup);
    const numbers = [...markup.matchAll(/<input\b[^>]*>/g)].filter(match => attributes(match[0]).type === "number");
    expect(numbers.filter(match => /\bdisabled=/.test(match[0]))).toHaveLength(numbers.length / 2);
    for (const input of numbers) expect(names.has(attributes(input[0]).id)).toBe(true);
  });
});
