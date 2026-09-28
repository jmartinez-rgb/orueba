import { getSession, requirePermission, requireAuth } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isPatchablePath, mergeSettings, setSettingAtPath, settingsSchema } from "@/lib/config/settings";
import { maskAddress } from "@/lib/format";
import { invalidate } from "@/lib/data/cache";
import { baseSettings, getAppContext, SETTINGS_RECORD_KEY } from "@/lib/services/context";
import { getRecordStore } from "@/lib/records/store";
import { logActivity } from "@/lib/services/activity";
import { badRequest, forbidden, json, readJson, serverError, unauthorized } from "@/lib/services/http";
import { isValidTimeZone } from "@/lib/time/tz";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuth())) return unauthorized();
  const [ctx, session] = await Promise.all([getAppContext(), getSession()]);
  const full = can(session.role, "settings:write");
  return json({
    ok: true,
    mode: ctx.mode,
    settings: full ? ctx.settings : { ...ctx.settings, recipients: ctx.settings.recipients.map((r) => ({ ...r, address: maskAddress(r.address) })) },
  });
}

export async function PUT(req: Request) {
  const session = await requirePermission("settings:write");
  if (!session) return forbidden();
  const body = await readJson(req);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return badRequest(`Configuración inválida: ${parsed.error.issues.map((i) => i.path.join(".")).slice(0, 5).join(", ")}`);
  const s = parsed.data;
  if (!(s.thresholds.attention < s.thresholds.alert && s.thresholds.alert < s.thresholds.critical)) return badRequest("Los umbrales deben cumplir atención < alerta < crítico.");
  if (!isValidTimeZone(s.timezone)) return badRequest("Zona horaria inválida.");
  if (s.schedule.startHour > s.schedule.endHour) return badRequest("La hora de inicio debe ser menor o igual a la de fin.");
  const merged = mergeSettings(baseSettings(), s);
  try {
    const ctx = await getAppContext();
    if (ctx.mode === "bigquery" && ctx.store.saveSettingsPatch) {
      await ctx.store.saveSettingsPatch(merged, session.user.name);
    } else {
      await getRecordStore().set(SETTINGS_RECORD_KEY, merged);
    }
    await logActivity(session, "SETTINGS_CHANGED", "Configuración del monitoreo actualizada.");
    invalidate("live:");
    invalidate("replay:");
    invalidate("settings:");
    return json({ ok: true, settings: merged });
  } catch (err) {
    return serverError("api", err, "settings");
  }
}

export async function DELETE() {
  const session = await requirePermission("settings:write");
  if (!session) return forbidden();
  const ctx = await getAppContext();
  if (ctx.mode === "bigquery" && ctx.store.saveSettingsPatch) await ctx.store.saveSettingsPatch(null, session.user.name);
  else await getRecordStore().delete(SETTINGS_RECORD_KEY);
  await logActivity(session, "SETTINGS_CHANGED", "Configuración restablecida a valores por defecto.");
  invalidate("live:");
  invalidate("replay:");
  invalidate("settings:");
  return json({ ok: true });
}

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
  const body = await readJson<{ path?: string; value?: unknown }>(req);
  if (!body || typeof body.path !== "string" || !isPatchablePath(body.path) || body.value === undefined) return badRequest("Cambio inválido.");
  try {
    const ctx = await getAppContext();
    const next = setSettingAtPath(ctx.settings, body.path, body.value);
    if (!next) return badRequest("El valor no es válido para esta configuración.");
    if (ctx.mode === "bigquery" && ctx.store.saveSettingsPatch) await ctx.store.saveSettingsPatch(next, session.user.name);
    else await getRecordStore().set(SETTINGS_RECORD_KEY, next);
    invalidate("live:");
    invalidate("replay:");
    invalidate("settings:");
    const root = Object.keys(PATH_LABEL).find((k) => body.path === k || body.path!.startsWith(`${k}.`)) ?? body.path;
    await logActivity(session, "SETTINGS_CHANGED", `${PATH_LABEL[root] ?? root} (${body.path})`);
    return json({ ok: true, settings: next });
  } catch (err) {
    return serverError("api", err, "settings:patch");
  }
}
