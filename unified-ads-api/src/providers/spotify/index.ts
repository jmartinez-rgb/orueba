import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";

/** Spotify Ads. Se integra en la Fase 6, tras revisar la documentación oficial vigente. */
export class SpotifyProvider extends BaseProvider {
  constructor(env: Readonly<Record<string, string | undefined>>) {
    super(Provider.SPOTIFY, ["SPOTIFY_ADS_CLIENT_ID", "SPOTIFY_ADS_CLIENT_SECRET", "SPOTIFY_ADS_REFRESH_TOKEN"], env);
  }
}
