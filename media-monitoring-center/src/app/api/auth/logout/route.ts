import { cookies, headers } from "next/headers";
import { auditUser, getSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/token";
import { recordAudit, requestInfo } from "@/lib/records/audit";
import { json } from "@/lib/services/http";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (session.authenticated && session.mode === "password") {
    await recordAudit({ type: "LOGOUT", user: auditUser(session), detail: null, ...requestInfo(await headers()), sid: session.sid }).catch(() => {});
  }
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
}
