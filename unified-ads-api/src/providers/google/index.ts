import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";

/** Google Ads. La integración (OAuth, MCC, GAQL) llega en la Fase 2, tras revisar la documentación oficial vigente. */
export class GoogleProvider extends BaseProvider {
  constructor(env: Readonly<Record<string, string | undefined>>) {
    super(
      Provider.GOOGLE,
      ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"],
      env,
    );
  }
}
