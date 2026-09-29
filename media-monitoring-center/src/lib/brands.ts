/**
 * Marcas monitoreadas. Cada marca es un monitoreo aparte (sus cuentas, alertas, incidentes,
 * tickets y mensajes) y se cambia con un botón en la barra superior.
 *
 * La marca se decide por el nombre de la cuenta ("Sky - ABCW", "Sky Performance - MXN" → Sky;
 * "izzi - Ofertas", "MXN - izzi 1" → izzi). Si la cuenta es mixta ("izzi - Sky Social") o no
 * menciona ninguna marca, decide el nombre de la campaña ("Sky / Seguidores…"); si tampoco,
 * es izzi. Una campaña de una cuenta de izzi que promociona contenido de Sky ("WhatsApp//SKY
 * SPORTS//izzi telecom") sigue siendo de izzi porque manda la cuenta.
 */
export type BrandId = "izzi" | "sky";

export const BRAND_IDS: BrandId[] = ["izzi", "sky"];
export const DEFAULT_BRAND: BrandId = "izzi";
export const BRAND_COOKIE = "immc_brand";

export interface BrandInfo {
  id: BrandId;
  /** Nombre visible ("izzi", "Sky"). */
  name: string;
  /** Para títulos y mensajes en mayúsculas. */
  upper: string;
  /** Color de marca (acento de la interfaz cuando la marca está activa). */
  color: string;
  /** Texto legible sobre el color de marca. */
  ink: string;
  /**
   * Prefijo de los folios de alertas, incidentes, notificaciones y corridas. izzi conserva los
   * folios de siempre (INC-0001); Sky usa SKY-INC-0001 para que nunca se crucen.
   */
  idPrefix: string;
}

export const BRANDS: Record<BrandId, BrandInfo> = {
  izzi: { id: "izzi", name: "izzi", upper: "IZZI", color: "#00C1B5", ink: "#04110f", idPrefix: "" },
  sky: { id: "sky", name: "Sky", upper: "SKY", color: "#1F6FEB", ink: "#ffffff", idPrefix: "SKY-" },
};

export function isBrand(v: unknown): v is BrandId {
  return v === "izzi" || v === "sky";
}

export function parseBrand(v: unknown): BrandId {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return isBrand(t) ? t : DEFAULT_BRAND;
}

const PATTERNS: Record<BrandId, RegExp> = {
  izzi: /(^|[^a-z0-9])izzi([^a-z0-9]|$)/i,
  sky: /(^|[^a-z0-9])sky([^a-z0-9]|$)/i,
};

/** Marcas que menciona un texto, en el orden en que aparecen. */
export function brandsIn(text: string | null | undefined): BrandId[] {
  const t = (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return BRAND_IDS.map((b) => ({ b, i: t.search(PATTERNS[b]) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.b);
}

/** Marca de una cuenta por su nombre; null si es mixta o no menciona ninguna. */
export function brandOfAccount(accountName: string | null | undefined): BrandId | null {
  const found = brandsIn(accountName);
  return found.length === 1 ? found[0] : null;
}

/** Marca de una campaña: manda la cuenta; si es mixta o neutra, la campaña; si no, izzi. */
export function brandOfCampaign(accountName: string | null | undefined, campaignName: string | null | undefined): BrandId {
  return brandOfAccount(accountName) ?? brandsIn(campaignName)[0] ?? DEFAULT_BRAND;
}
