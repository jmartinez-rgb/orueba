import type { PlatformId } from "@/lib/types";

/**
 * Clasificadores de estrategia por nombre de campaña. Replican EXACTAMENTE las fórmulas que usa
 * el equipo en Google Sheets (SI(ESNUMERO(HALLAR(...))) anidados): se evalúan en orden y gana la
 * primera coincidencia. HALLAR/SEARCH no distingue mayúsculas pero sí acentos ("gené" ≠ "gene").
 */

export type ClassifierField = "campaign" | "secondary";

export interface ClassifierRule {
  id: string;
  /** Texto a buscar (sin distinguir mayúsculas). */
  contains: string;
  /** Dónde se busca: nombre de campaña o campo secundario (Meta: columna D; Google: columna L). */
  field: ClassifierField;
  label: string;
}

export interface ClassifierConfig {
  rules: ClassifierRule[];
  /** Qué se asigna si ninguna regla coincide: un texto fijo, el campo secundario o el objetivo. */
  fallback: { type: "label" | "secondary" | "objective"; label: string };
  /** Qué representa el campo secundario en esta plataforma (para la guía). */
  secondaryLabel: string;
}

const r = (id: string, contains: string, label: string, field: ClassifierField = "campaign"): ClassifierRule => ({ id, contains, label, field });

/** Fórmula de Meta (C = nombre de campaña, D = objetivo/conjunto). */
export const META_CLASSIFIER: ClassifierConfig = {
  rules: [
    r("m1", "Negocios", "Negocios"),
    r("m2", "CAPI WHATSAPP", "CAPI WhatsApp"),
    r("m3", "Sitio Web", "Web"),
    r("m4", "Venta", "Venta"),
    r("m5", "WhatsApp", "WhatsApp o Messenger"),
    r("m6", "SALES", "Sales Force"),
    r("m7", "Auronix", "Auronix"),
    r("m8", "Performance 2024 | Móvil", "Formulario móvil"),
    r("m9", "Performance | Móvil", "Formulario móvil"),
    r("m10", "LEAD", "Formulario", "secondary"),
    r("m11", "Temporal", "Branding - Temporales"),
    r("m12", "Brand 100% l Digital", "Branding 100% Digital"),
    r("m13", "móvil", "Branding móvil"),
    r("m14", "Performance 2024 | Nuevos Artes |", "WhatsApp o Messenger"),
    r("m15", "Llamada", "Llamadas"),
    r("m16", "WhatsApp", "WhatsApp o Messenger"),
  ],
  fallback: { type: "label", label: "Branding" },
  secondaryLabel: "Columna D (objetivo de la campaña, p. ej. OUTCOME_LEADS)",
};

/** Fórmula de Google (D = nombre de campaña, L = tipo de campaña como respaldo). */
export const GOOGLE_CLASSIFIER: ClassifierConfig = {
  rules: [
    r("g1", "Genéricas Maradona", "SEARCH MARADONA"),
    r("g2", "gené", "SEARCH GENÉRICA"),
    r("g3", "izzi móvil DEMAND GEN", "DEMAND GEN"),
    r("g4", "maradona", "SEARCH MARADONA"),
    r("g5", "nego", "SEARCH NEGOCIOS"),
    r("g6", "competencia", "SEARCH COMPETENCIA"),
    r("g7", "Pmax", "PERFORMANCE_MAX"),
    r("g8", "izzi móvil DEMAND GEN", "DEMAND GEN"),
  ],
  fallback: { type: "secondary", label: "Sin clasificar" },
  secondaryLabel: "Columna L (tipo de campaña: SEARCH, PERFORMANCE_MAX, DEMAND_GEN, VIDEO…)",
};

const OBJECTIVE_ONLY: ClassifierConfig = { rules: [], fallback: { type: "objective", label: "Sin clasificar" }, secondaryLabel: "Objetivo reportado por la plataforma" };

export const DEFAULT_CLASSIFIERS: Record<PlatformId, ClassifierConfig> = {
  google: GOOGLE_CLASSIFIER,
  meta: META_CLASSIFIER,
  tiktok: OBJECTIVE_ONLY,
  microsoft: OBJECTIVE_ONLY,
  spotify: OBJECTIVE_ONLY,
  x: OBJECTIVE_ONLY,
};
