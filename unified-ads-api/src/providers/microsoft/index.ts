import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";

/** Microsoft Advertising. Se integra en la Fase 5 (reportes asíncronos), tras revisar la documentación oficial vigente. */
export class MicrosoftProvider extends BaseProvider {
  constructor(env: Readonly<Record<string, string | undefined>>) {
    super(
      Provider.MICROSOFT,
      [
        "MICROSOFT_ADS_DEVELOPER_TOKEN",
        "MICROSOFT_ADS_CLIENT_ID",
        "MICROSOFT_ADS_CLIENT_SECRET",
        "MICROSOFT_ADS_REFRESH_TOKEN",
      ],
      env,
    );
  }
}
