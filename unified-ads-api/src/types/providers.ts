/** Plataformas publicitarias que la API unifica. */
export enum Provider {
  GOOGLE = "GOOGLE",
  META = "META",
  TIKTOK = "TIKTOK",
  MICROSOFT = "MICROSOFT",
  SPOTIFY = "SPOTIFY",
  X = "X",
}

export const PROVIDERS: readonly Provider[] = [
  Provider.GOOGLE,
  Provider.META,
  Provider.TIKTOK,
  Provider.MICROSOFT,
  Provider.SPOTIFY,
  Provider.X,
];

/** Identificador en URLs y respuestas: /api/v1/providers/google/status. */
export type ProviderSlug = "google" | "meta" | "tiktok" | "microsoft" | "spotify" | "x";

export const PROVIDER_SLUG: Record<Provider, ProviderSlug> = {
  [Provider.GOOGLE]: "google",
  [Provider.META]: "meta",
  [Provider.TIKTOK]: "tiktok",
  [Provider.MICROSOFT]: "microsoft",
  [Provider.SPOTIFY]: "spotify",
  [Provider.X]: "x",
};

export const PROVIDER_SLUGS = PROVIDERS.map((p) => PROVIDER_SLUG[p]) as readonly ProviderSlug[];

export function providerFromSlug(slug: string): Provider | null {
  const found = PROVIDERS.find((p) => PROVIDER_SLUG[p] === slug.toLowerCase());
  return found ?? null;
}

export const PROVIDER_NAME: Record<Provider, string> = {
  [Provider.GOOGLE]: "Google Ads",
  [Provider.META]: "Meta Ads",
  [Provider.TIKTOK]: "TikTok Ads",
  [Provider.MICROSOFT]: "Microsoft Advertising",
  [Provider.SPOTIFY]: "Spotify Ads",
  [Provider.X]: "X Ads",
};
