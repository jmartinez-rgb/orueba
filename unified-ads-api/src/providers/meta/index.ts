import { Provider } from "../../types/providers.js";
import { BaseProvider } from "../base-provider.js";

/** Meta Marketing API. Se integra en la Fase 3, tras revisar la documentación oficial vigente. */
export class MetaProvider extends BaseProvider {
  constructor(env: Readonly<Record<string, string | undefined>>) {
    super(Provider.META, ["META_ACCESS_TOKEN"], env);
  }
}
