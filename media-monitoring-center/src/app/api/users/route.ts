import { requirePermission } from "@/lib/auth/session";
import { createAccount, toView } from "@/lib/auth/user-admin";
import { effectiveUniversal, listAccounts } from "@/lib/auth/users";
import { logActivity } from "@/lib/services/activity";
import { forbidden, json, readJson, serverError } from "@/lib/services/http";

export const dynamic = "force-dynamic";

const DENIED = "Solo quien administra usuarios puede ver o cambiar cuentas y contraseñas.";

/** Cuentas (Netlify + app) y la contraseña universal, sin hashes. */
export async function GET() {
  const session = await requirePermission("users:manage");
  if (!session) return forbidden(DENIED);
  try {
    const [accounts, universal] = await Promise.all([listAccounts(), effectiveUniversal()]);
    return json({
      ok: true,
      accounts: accounts.map(toView),
      universal: { enabled: universal.enabled, role: universal.role, brands: universal.brands, source: universal.source },
    });
  } catch (err) {
    return serverError("api", err, "users");
  }
}

export async function POST(req: Request) {
  const session = await requirePermission("users:manage");
  if (!session) return forbidden(DENIED);
  try {
    const res = await createAccount({ id: session.user.id, name: session.user.name, permissions: session.permissions }, await readJson(req));
    if (!res.ok) return json({ ok: false, message: res.message }, res.status);
    const a = res.value.account;
    await logActivity(session, "USER_CREATED", `${a.username} (${a.name}) · ${a.role}${a.customPermissions ? " · permisos personalizados" : ""}${a.brands.length ? ` · ${a.brands.join(", ")}` : ""}`);
    return json({ ok: true, account: a });
  } catch (err) {
    return serverError("api", err, "users");
  }
}
