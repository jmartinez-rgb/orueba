import type { CampaignObjective } from "@/lib/types";

/** Heurística de objetivo por nombre de campaña (se puede corregir en Settings). */
export function inferObjective(name: string | null, raw: string | null): CampaignObjective {
  const t = `${raw ?? ""} ${name ?? ""}`.toLowerCase();
  if (/capi/.test(t)) return "PURCHASES";
  if (/whats|msg|mensaje/.test(t)) return "WHATSAPP";
  if (/lead|registro|formulario/.test(t)) return "LEADS";
  if (/llamad|call/.test(t)) return "CALLS";
  if (/venta|sale|compra|purchase|pmax|paquete|oferta/.test(t)) return "SALES";
  if (/video|youtube/.test(t)) return "VIDEO";
  if (/alcance|awareness|reach|branding|marca/.test(t)) return "AWARENESS";
  if (/trafico|tráfico|traffic|clic/.test(t)) return "TRAFFIC";
  if (/engagement|interacc|seguidores/.test(t)) return "ENGAGEMENT";
  return "CONVERSIONS";
}
