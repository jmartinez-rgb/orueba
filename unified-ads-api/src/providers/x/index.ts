import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";

/** X Ads. Se integra en la Fase 7; puede requerir aprobación de acceso (estado access_required). */
export class XProvider extends BaseProvider {
  constructor(env: Readonly<Record<string, string | undefined>>) {
    super(
      Provider.X,
      ["X_ADS_CONSUMER_KEY", "X_ADS_CONSUMER_SECRET", "X_ADS_ACCESS_TOKEN", "X_ADS_ACCESS_TOKEN_SECRET"],
      env,
    );
  }
}
