import type { MonitoringSettings } from "@/lib/config/settings";
import type { Anomaly, SilencedAnomaly } from "@/lib/monitoring/types";
import type { Authorization } from "./types";

const pct = (v: number | null) => (v === null ? "s/d" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

export function isAuthorizationActive(a: Authorization, at: string): boolean {
  return a.revokedAt === null && a.createdAt <= at && a.until > at;
}

/**
 * ¿La autorización cubre esta anomalía? La misma huella, sus alertas agrupadas y, en la misma
 * familia, lo que está dentro de su alcance (una cuenta cubre sus campañas; una plataforma, sus
 * cuentas y campañas).
 */
export function authorizationCovers(auth: Authorization, a: Anomaly): boolean {
  if (a.type === "DATA_ISSUE") return false;
  if (auth.fingerprint === a.fingerprint || a.groupedUnder === auth.fingerprint) return true;
  if (a.family !== auth.family || a.platform !== auth.platform) return false;
  if (auth.level === "platform") return a.level !== "platform";
  if (auth.level === "account") return a.level === "campaign" && a.accountId === auth.accountId;
  return false;
}

/** Vuelve a alertar si empeoró más de lo autorizado o si se volvió un apagado masivo que no se autorizó. */
export function exceedsAuthorization(auth: Authorization, a: Anomaly, settings: MonitoringSettings): string | null {
  if (!auth.massStop && a.breakdown?.verdict === "mass_stop") return "se volvió un apagado masivo";
  if (auth.deviation !== null && a.deviation !== null && Math.abs(a.deviation) - Math.abs(auth.deviation) >= settings.alerts.worsenDeltaPts) {
    return `se autorizó con ${pct(auth.deviation)} y hoy va ${pct(a.deviation)}`;
  }
  return null;
}

/**
 * Separa las anomalías cubiertas por un cambio autorizado vigente. Las que empeoran más allá de
 * lo autorizado siguen alertando, con la explicación.
 */
export function applyAuthorizations(anomalies: Anomaly[], authorizations: Authorization[], at: string, settings: MonitoringSettings): { kept: Anomaly[]; silenced: SilencedAnomaly[] } {
  const active = authorizations.filter((a) => isAuthorizationActive(a, at));
  if (!active.length) return { kept: anomalies, silenced: [] };
  const byFingerprint = new Map(anomalies.map((a) => [a.fingerprint, a]));
  const kept: Anomaly[] = [];
  const silenced: SilencedAnomaly[] = [];
  for (const a of anomalies) {
    const auth = active.find((x) => authorizationCovers(x, a));
    if (!auth) {
      kept.push(a);
      continue;
    }
    const main = byFingerprint.get(auth.fingerprint) ?? (a.fingerprint === auth.fingerprint ? a : undefined);
    const exceeded = main ? exceedsAuthorization(auth, main, settings) : null;
    if (exceeded) {
      if (a === main) a.adjustments = [...a.adjustments, `Había un cambio autorizado por ${auth.authorizedBy} ("${auth.reason}"), pero ${exceeded}: vuelve a alertar.`];
      kept.push(a);
      continue;
    }
    silenced.push({ anomaly: a, authorizationId: auth.id, by: auth.authorizedBy, reason: auth.reason, until: auth.until });
  }
  return { kept, silenced };
}
