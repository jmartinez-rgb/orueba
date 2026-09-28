import type { Campaign } from "@/lib/types";
import { OBJECTIVE_LABEL } from "@/lib/metrics";
import type { ClassifierConfig, ClassifierRule } from "./defaults";

/** Igual que HALLAR/SEARCH de Sheets: sin distinguir mayúsculas, sí acentos. */
function contains(text: string, pattern: string): boolean {
  return text.toLocaleLowerCase("es-MX").includes(pattern.toLocaleLowerCase("es-MX"));
}

export interface ClassificationResult {
  label: string;
  /** Posición (1..n) de la regla que coincidió; null = respaldo. */
  ruleIndex: number | null;
  rule: ClassifierRule | null;
}

export function classify(config: ClassifierConfig, input: { campaign: string; secondary?: string | null; objective?: string | null }): ClassificationResult {
  for (let i = 0; i < config.rules.length; i++) {
    const rule = config.rules[i];
    const text = rule.field === "campaign" ? input.campaign : (input.secondary ?? "");
    if (rule.contains && contains(text, rule.contains)) return { label: rule.label, ruleIndex: i + 1, rule };
  }
  const fb = config.fallback;
  if (fb.type === "secondary" && input.secondary?.trim()) return { label: input.secondary.trim(), ruleIndex: null, rule: null };
  if (fb.type === "objective" && input.objective) return { label: input.objective, ruleIndex: null, rule: null };
  return { label: fb.label, ruleIndex: null, rule: null };
}

export function classifyCampaign(config: ClassifierConfig, c: Pick<Campaign, "name" | "sourceType" | "objective">): string {
  return classify(config, { campaign: c.name, secondary: c.sourceType ?? null, objective: OBJECTIVE_LABEL[c.objective] }).label;
}

/**
 * Reglas que nunca se aplican porque una regla anterior (mismo campo) busca un texto contenido
 * en el suyo: todo lo que la activaría ya fue clasificado antes (p. ej. "WhatsApp" repetido).
 */
export function unreachableRules(config: ClassifierConfig): Array<{ index: number; shadowedBy: number }> {
  const out: Array<{ index: number; shadowedBy: number }> = [];
  config.rules.forEach((rule, j) => {
    for (let i = 0; i < j; i++) {
      const prev = config.rules[i];
      if (prev.field === rule.field && prev.contains && contains(rule.contains, prev.contains)) {
        out.push({ index: j + 1, shadowedBy: i + 1 });
        return;
      }
    }
  });
  return out;
}
