import { getViewContext } from "@/lib/services/context";
import { DomainSwitch } from "./domain-switch";

/**
 * Selector de dominio de Google Ads. Los dominios clasifican solo cuentas de Google, así que el selector
 * aparece únicamente en las vistas de Google (página de Google Ads y Absolute Top); el resto del
 * monitoreo siempre muestra la marca completa.
 */
export async function GoogleDomainScope() {
  const ctx = await getViewContext(undefined, "domain").catch(() => null);
  if (!ctx || ctx.brand !== "izzi" || !ctx.domain) return null;
  const options = [{ id: "all", name: "Todos los dominios" }, ...(ctx.domainConfig?.domains ?? []).map(({ id, name }) => ({ id, name })), ...(ctx.domainConfig ? [{ id: "unclassified", name: "Sin clasificar" }] : [])];
  return <DomainSwitch current={ctx.domain} options={options} enabled={!!ctx.domainConfig} />;
}
