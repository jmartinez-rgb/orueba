import { cookies } from "next/headers";
import { getSession, requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { mergeSettings, settingsSchema } from "@/lib/config/settings";
import { maskAddress } from "@/lib/format";
import { invalidate } from "@/lib/data/cache";
import { baseSettings, getAppContext, SETTINGS_COOKIE } from "@/lib/services/context";
import { badRequest, forbidden, json, readJson, serverError } from "@/lib/services/http";
import { isValidTimeZone } from "@/lib/time/tz";

export const dynamic = "force-dynamic";

export async function GET() {
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
      const c = await cookies();
      c.set(SETTINGS_COOKIE, JSON.stringify(merged), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
    }
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
  else (await cookies()).delete(SETTINGS_COOKIE);
  invalidate("live:");
  invalidate("replay:");
  invalidate("settings:");
  return json({ ok: true });
}
