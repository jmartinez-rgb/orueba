import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";

/** TikTok Ads. Se integra en la Fase 4, tras revisar la documentación oficial vigente. */
export class TikTokProvider extends BaseProvider {
  constructor(env: Readonly<Record<string, string | undefined>>) {
    super(Provider.TIKTOK, ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET", "TIKTOK_ACCESS_TOKEN"], env);
  }
}
