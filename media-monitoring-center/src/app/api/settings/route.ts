import { getSession, requirePermission, requireAuth, hasPermission } from "@/lib/auth/session";
import { applyEditedSettings, isPatchablePath, setSettingAtPath, settingsSchema } from "@/lib/config/settings";
import { maskAddress } from "@/lib/format";
import { getAppContext, loadStoredSettings, saveStoredSettings } from "@/lib/services/context";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";
import { isValidTimeZone } from "@/lib/time/tz";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { fxRateChanges } from "@/lib/config/fx-audit";
import { withSettingsWrite } from "@/lib/services/settings-lock";
import { sameSettingValue, settingsRevision, SettingsConflictError } from "@/lib/config/settings-revision";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuth())) return unauthorized();
  const [ctx, session] = await Promise.all([getAppContext(), getSession()]);
  const full = hasPermission(session, "settings:write");
  return json({
    ok: true,
    mode: ctx.mode,
    revision: full ? ctx.settingsRevision : undefined,
    settings: full ? ctx.settings : { ...ctx.settings, recipients: ctx.settings.recipients.map((r) => ({ ...r, address: maskAddress(r.address) })) },
  });
}

export async function PUT(req: Request) {
  const session = await requirePermission("settings:write");
  if (!session) return forbidden();
  if (!req.headers.get("If-Match")) return preconditionRequired();
  const body = await readJson(req);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return badRequest(`Configuración inválida: ${parsed.error.issues.map((i) => i.path.join(".")).slice(0, 5).join(", ")}`);
  const s = parsed.data;
  if (!(s.thresholds.attention < s.thresholds.alert && s.thresholds.alert < s.thresholds.critical)) return badRequest("Los umbrales deben cumplir atención < alerta < crítico.");
  if (!isValidTimeZone(s.timezone)) return badRequest("Zona horaria inválida.");
  if (s.schedule.startHour > s.schedule.endHour) return badRequest("La hora de inicio debe ser menor o igual a la de fin.");
  try {
    return await withSettingsWrite(async () => {
      const ctx = await getAppContext();
      const stored = await loadStoredSettings(ctx);
      if (req.headers.get("If-Match") !== settingsRevision(stored, ctx)) return conflict();
      const merged = applyEditedSettings(stored, ctx.settings, s);
      if (!merged) return badRequest("Configuración inválida.");
      await saveStoredSettings(ctx, merged, session.user.name, stored);
      const changes = fxRateChanges(stored.currency.rates, merged.currency.rates);
      await logActivity(session, "SETTINGS_CHANGED", `Configuración del monitoreo actualizada.${changes ? ` Tipo de cambio: ${changes}.` : ""}`);
      return json({ ok: true, settings: merged, revision: settingsRevision(merged, ctx) });
    });
  } catch (err) {
    if (err instanceof SettingsConflictError) return conflict();
    return serverError("api", err, "settings");
  }
}

export async function DELETE(req: Request) {
  const session = await requirePermission("settings:write");
  if (!session) return forbidden();
  if (!req.headers.get("If-Match")) return preconditionRequired();
  try {
    return await withSettingsWrite(async () => {
      const ctx = await getAppContext();
      const stored = await loadStoredSettings(ctx);
      if (req.headers.get("If-Match") !== settingsRevision(stored, ctx)) return conflict();
      await saveStoredSettings(ctx, null, session.user.name, stored);
      const changes = fxRateChanges(stored.currency.rates, DEFAULT_SETTINGS.currency.rates);
      await logActivity(session, "SETTINGS_CHANGED", `Configuración restablecida a valores por defecto.${changes ? ` Tipo de cambio: ${changes}.` : ""}`);
      return json({ ok: true });
    });
  } catch (err) {
    if (err instanceof SettingsConflictError) return conflict();
    return serverError("api", err, "settings:delete");
  }
}

const conflict = () => json({ ok: false, message: new SettingsConflictError().message }, 412);
const preconditionRequired = () => json({ ok: false, message: "Recarga esta pantalla para obtener los valores vigentes antes de guardar." }, 428);

const PATH_LABEL: Record<string, string> = {
  platformMetrics: "Métrica monitoreada por plataforma",
  fixedTargets: "Métricas y objetivos fijos",
  "currency.rates": "Tipo de cambio mensual",
  "currency.accountCurrency": "Moneda de cuentas",
  budgetLevels: "Nivel de presupuesto por cuenta",
  classifiers: "Clasificadores de estrategia",
  ingestion: "Modo de ingesta por plataforma",
  report: "Mensaje de monitoreo",
  objectiveOverrides: "Objetivo de campañas",
};

/** Cambio puntual de una sección (p. ej. la métrica de una plataforma desde Overview). */
export async function PATCH(req: Request) {
  const session = await requirePermission("settings:write");
  if (!session) return forbidden("Solo administradores y co-administradores pueden cambiar esta configuración.");
  const body = await readJson<{ path?: string; value?: unknown; expectedValue?: unknown }>(req);
  if (!body || typeof body.path !== "string" || !isPatchablePath(body.path) || body.value === undefined) return badRequest("Cambio inválido.");
  const path = body.path;
  try {
    return await withSettingsWrite(async () => {
      const ctx = await getAppContext();
      // Sobre lo guardado (leído en este momento), no sobre la configuración vigente de la marca.
      const stored = await loadStoredSettings(ctx);
      const guarded = path === "currency.rates" || path.startsWith("currency.rates.") || path === "currency.accountCurrency" || path.startsWith("currency.accountCurrency.");
      if (guarded && !Object.hasOwn(body, "expectedValue")) return preconditionRequired();
      if (Object.hasOwn(body, "expectedValue")) {
        const current = path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, stored);
        if (!sameSettingValue(current, body.expectedValue)) return conflict();
      }
      const next = setSettingAtPath(stored, path, body.value);
      if (!next) return badRequest("El valor no es válido para esta configuración.");
      await saveStoredSettings(ctx, next, session.user.name, stored);
      const root = Object.keys(PATH_LABEL).find((k) => path === k || path.startsWith(`${k}.`)) ?? path;
      const changes = fxRateChanges(stored.currency.rates, next.currency.rates);
      await logActivity(session, "SETTINGS_CHANGED", `${PATH_LABEL[root] ?? root} (${path})${changes ? `: ${changes}` : ""}`);
      return json({ ok: true, settings: next });
    });
  } catch (err) {
    if (err instanceof SettingsConflictError) return conflict();
    return serverError("api", err, "settings:patch");
  }
}
