import { PROVIDERS, providerFromSlug, type Provider } from "../types/providers.js";
import type { AdsProvider } from "./provider.js";
import type { RotatingToken } from "../config/token-store.js";
import { GoogleProvider } from "./google/index.js";
import { MetaProvider } from "./meta/index.js";
import { TikTokProvider } from "./tiktok/index.js";
import { MicrosoftProvider } from "./microsoft/index.js";
import { SpotifyProvider } from "./spotify/index.js";
import { XProvider } from "./x/index.js";

/** Registro de proveedores: un único punto para obtener cualquier integración. */
export class ProviderRegistry {
  private readonly byId: Map<Provider, AdsProvider>;

  constructor(providers: AdsProvider[]) {
    this.byId = new Map(providers.map((p) => [p.id, p]));
  }

  static fromEnv(
    env: Readonly<Record<string, string | undefined>>,
    timeoutMs?: number,
    onRefreshTokenRotated?: (name: RotatingToken, token: string) => void,
  ): ProviderRegistry {
    return new ProviderRegistry([
      new GoogleProvider(env, { timeoutMs }),
      new MetaProvider(env, { timeoutMs }),
      new TikTokProvider(env, { timeoutMs }),
      new MicrosoftProvider(env, {
        timeoutMs,
        onRefreshTokenRotated: (token) => onRefreshTokenRotated?.("MICROSOFT_ADS_REFRESH_TOKEN", token),
      }),
      new SpotifyProvider(env, {
        timeoutMs,
        onRefreshTokenRotated: (token) => onRefreshTokenRotated?.("SPOTIFY_ADS_REFRESH_TOKEN", token),
      }),
      new XProvider(env),
    ]);
  }

  list(): AdsProvider[] {
    return PROVIDERS.map((id) => this.byId.get(id)).filter((p): p is AdsProvider => p !== undefined);
  }

  get(id: Provider): AdsProvider | undefined {
    return this.byId.get(id);
  }

  bySlug(slug: string): AdsProvider | undefined {
    const id = providerFromSlug(slug);
    return id ? this.byId.get(id) : undefined;
  }
}
