/**
 * Fuentes oficiales que respaldan los criterios de la auditoría. Consultadas el 2026-10-02.
 * Las páginas de ayuda de Google no se pudieron abrir directamente desde el entorno de desarrollo
 * (salida bloqueada); se consultaron mediante búsqueda web restringida a support.google.com y
 * developers.google.com. El documento de descubrimiento v25 se descargó y leyó completo.
 */

export interface Source {
  title: string;
  url: string;
  type: string;
  method: "directa" | "búsqueda";
}

export const CONSULTED_ON = "2026-10-02";

const help = (id: string) => `https://support.google.com/google-ads/answer/${id}`;
const H = "Google Ads Help (oficial)";

export const SOURCES = {
  discovery: {
    title: "Google Ads API v25: documento de descubrimiento (campos, enumeraciones y descripciones de métricas)",
    url: "https://googleads.googleapis.com/$discovery/rest?version=v25",
    type: "Google Ads API (oficial)",
    method: "directa",
  },
  changeEvent: {
    title: "Change Event: últimos 30 días y LIMIT máximo de 10,000",
    url: "https://developers.google.com/google-ads/api/docs/change-event",
    type: "Google Ads API Docs (oficial)",
    method: "búsqueda",
  },
  rsa: {
    title: "About responsive search ads (hasta 15 títulos y 4 descripciones; fijado)",
    url: help("7684791"),
    type: H,
    method: "búsqueda",
  },
  adStrength: {
    title: "About Ad Strength for responsive search ads",
    url: help("9921843"),
    type: H,
    method: "búsqueda",
  },
  rsaBest: {
    title: "Best practices for creating effective responsive search ads",
    url: help("6167122"),
    type: H,
    method: "búsqueda",
  },
  sitelinks: {
    title: "About sitelink assets (al menos 4; 6 en alto volumen)",
    url: help("2375416"),
    type: H,
    method: "búsqueda",
  },
  callouts: { title: "About callout assets (al menos 4)", url: help("6079510"), type: H, method: "búsqueda" },
  snippets: { title: "About structured snippet assets", url: help("6280012"), type: H, method: "búsqueda" },
  assetTypes: { title: "Use as many asset types as possible", url: help("12073962"), type: H, method: "búsqueda" },
  smartBidding: {
    title: "About Smart Bidding (aprendizaje y variación por volumen)",
    url: help("7065882"),
    type: H,
    method: "búsqueda",
  },
  targetUpdate: {
    title: "Changes to target based bid strategies (desde el 17 de agosto de 2026)",
    url: help("17061251"),
    type: H,
    method: "búsqueda",
  },
  targetUpdateFaq: {
    title: "FAQ: changes to Target-based bid strategies",
    url: help("17125145"),
    type: H,
    method: "búsqueda",
  },
  targetChanges: {
    title: "Manage your Smart Bidding strategy (cambios de objetivo de ~20% y esperar una semana)",
    url: help("10276704"),
    type: H,
    method: "búsqueda",
  },
  limitedBudget: { title: 'Fix "Limited by budget"', url: help("2616012"), type: H, method: "búsqueda" },
  demandGen: {
    title: "Demand Gen campaign performance guide (presupuesto ≥10× tCPA; 50 conversiones; ±15%)",
    url: help("16797388"),
    type: H,
    method: "búsqueda",
  },
  goals: {
    title: "About conversion goals (primarias y secundarias)",
    url: help("10995103"),
    type: H,
    method: "búsqueda",
  },
  defaultGoals: { title: "About account-default conversion goals", url: help("4677036"), type: H, method: "búsqueda" },
  campaignGoals: {
    title: "About campaign-specific conversion goals",
    url: help("9143218"),
    type: H,
    method: "búsqueda",
  },
  goalChanges: {
    title: "Changing conversion goals and actions used for Smart Bidding",
    url: help("14571185"),
    type: H,
    method: "búsqueda",
  },
  pmaxSpecs: {
    title: "Performance Max campaigns specs and format requirements",
    url: help("17091269"),
    type: H,
    method: "búsqueda",
  },
  pmaxCreative: {
    title: "Best practices for Performance Max creative assets",
    url: help("14528221"),
    type: H,
    method: "búsqueda",
  },
  pmaxApiAssets: {
    title: "Performance Max asset requirements (API)",
    url: "https://developers.google.com/google-ads/api/performance-max/asset-requirements",
    type: "Google Ads API Docs (oficial)",
    method: "búsqueda",
  },
  pmaxAdStrength: { title: "About Performance Max Ad Strength", url: help("14143250"), type: H, method: "búsqueda" },
  searchThemes: {
    title: "Use search themes with your Performance Max campaign (hasta 50)",
    url: help("14767319"),
    type: H,
    method: "búsqueda",
  },
  finalUrlExpansion: {
    title: "About Final URL expansion in Performance Max (exclusiones de URL)",
    url: help("14337539"),
    type: H,
    method: "búsqueda",
  },
  qualityScore: {
    title: "About Quality Score for Search campaigns",
    url: help("6167118"),
    type: H,
    method: "búsqueda",
  },
  qualityScoreUse: {
    title: "5 ways to use Quality Score to improve your performance",
    url: help("6167130"),
    type: H,
    method: "búsqueda",
  },
  negatives: {
    title: "Get negative keyword ideas using the search terms report",
    url: help("7102466"),
    type: H,
    method: "búsqueda",
  },
  negativeConflicts: { title: "Fix issues with negative keywords", url: help("9701952"), type: H, method: "búsqueda" },
  optimizationScore: { title: "About optimization score", url: help("9061546"), type: H, method: "búsqueda" },
  dismissRecommendations: {
    title: "Apply or dismiss recommendations",
    url: help("10169817"),
    type: H,
    method: "búsqueda",
  },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
