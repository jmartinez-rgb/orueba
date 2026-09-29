import { requirePermission } from "@/lib/auth/session";
import { updateUniversal } from "@/lib/auth/user-admin";
import { logActivity } from "@/lib/services/activity";
import { forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** Contraseña universal: activar/desactivar, rol (Consulta o Paid Media Manager), marcas y contraseña. */
export async function PUT(req: Request) {
  const session = await requirePermission("users:manage");
  if (!session) return forbidden("Solo quien administra usuarios puede cambiar la contraseña universal.");
  try {
    const res = await updateUniversal({ id: session.user.id, name: session.user.name, permissions: session.permissions }, await readJson(req));
    if (!res.ok) return json({ ok: false, message: res.message }, res.status);
    if (res.value.changes.length) await logActivity(session, "UNIVERSAL_UPDATED", res.value.changes.join(", "));
    return json({ ok: true, enabled: res.value.enabled });
  } catch (err) {
    return serverError("api", err, "users/universal");
  }
}
