import type { Metadata } from "next";
import { KeyRound, ShieldCheck, UserRoundCheck } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can, ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/auth/roles";
import { getAuthConfig } from "@/lib/auth/config";
import { listAudit, listUsers } from "@/lib/records/audit";
import { getRecordStore, RECORD_BACKEND_LABEL } from "@/lib/records/store";
import { baseSettings } from "@/lib/services/context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { StateMessage } from "@/components/monitoring/states";
import { AccessLog } from "@/components/users/access-log";
import { PeopleTable } from "@/components/users/people-table";
import { AvatarGroup } from "@/components/rareui/avatar-group";
import { UserAvatar } from "@/components/users/user-avatar";

export const metadata: Metadata = { title: "Usuarios y accesos" };
export const dynamic = "force-dynamic";

/** Resumen de actividad reciente (se calcula por request en el servidor). */
function activitySummary(users: Awaited<ReturnType<typeof listUsers>>, audit: Awaited<ReturnType<typeof listAudit>>) {
  const now = Date.now();
  const recent = (iso: string, ms: number) => now - new Date(iso).getTime() < ms;
  return {
    now,
    online: users.filter((u) => recent(u.lastSeenAt, 30 * 60 * 1000)),
    today: audit.filter((a) => a.type === "LOGIN_OK" && recent(a.at, 24 * 3600 * 1000)).length,
    failed: audit.filter((a) => a.type === "LOGIN_FAILED" && recent(a.at, 24 * 3600 * 1000)).length,
  };
}

export default async function UsersPage() {
  const session = await requireSession("/usuarios");
  if (!can(session.role, "users:view")) {
    return <StateMessage kind="empty" title="Sin acceso" description="Solo administradores y co-administradores pueden ver la bitácora de accesos." />;
  }
  const cfg = getAuthConfig();
  const tz = baseSettings().timezone;
  const [users, audit] = await Promise.all([listUsers(), listAudit({ days: 30, limit: 1500 })]);
  const backend = getRecordStore().backend;
  const { now, online, today, failed } = activitySummary(users, audit);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Usuarios y accesos"
        subtitle={`Quién entra, cuándo y desde qué dispositivo. Registros guardados en: ${RECORD_BACKEND_LABEL[backend]}. Nunca se guardan contraseñas ni IP completas.`}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 pt-4">
            <UserRoundCheck className="size-5 text-brand-teal" />
            <div>
              <p className="text-2xl font-bold">{online.length}</p>
              <p className="text-xs text-muted-foreground">Activos en los últimos 30 min</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-4">
            <ShieldCheck className="size-5 text-status-normal-text" />
            <div>
              <p className="text-2xl font-bold">{today}</p>
              <p className="text-xs text-muted-foreground">Inicios de sesión en 24 h</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-4">
            <KeyRound className={failed ? "size-5 text-status-alert-text" : "size-5 text-muted-foreground"} />
            <div>
              <p className="text-2xl font-bold">{failed}</p>
              <p className="text-xs text-muted-foreground">Intentos fallidos en 24 h</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Personas</CardTitle>
              <CardDescription>Cada persona tiene su avatar (blobatar) generado a partir de su nombre.</CardDescription>
            </div>
            <AvatarGroup people={online.map((u) => ({ id: u.id, name: u.name, detail: ROLE_LABEL[u.role ?? "viewer"] }))} caption={online.length ? "Conectados ahora" : undefined} />
          </CardHeader>
          <CardContent>
            <PeopleTable users={users} timezone={tz} nowMs={now} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Acceso configurado</CardTitle>
              <CardDescription>Se administra con variables de entorno en Netlify (docs/AUTH.md).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Modo</span>
              <span className="font-semibold">{cfg.mode === "password" ? "Contraseña" : cfg.mode === "open" ? "Abierto (demo)" : cfg.mode === "header" ? "SSO por cabeceras" : "Sin configurar"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Duración de sesión</span>
              <span className="font-semibold">{cfg.sessionHours} h</span>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cuentas nominales</p>
              {cfg.accounts.length === 0 && <p className="text-xs text-muted-foreground">Ninguna (AUTH_USERS vacío).</p>}
              {cfg.accounts.map((a) => (
                <div key={a.username} className="flex items-center gap-2.5 rounded-md border px-2.5 py-1.5">
                  <UserAvatar name={a.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{a.username}</p>
                  </div>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold">{ROLE_LABEL[a.role]}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
              <span className="text-muted-foreground">Contraseña universal</span>
              <span className="font-semibold">{cfg.universalHash ? `Activa · ${ROLE_LABEL[cfg.universalRole]}` : "No configurada"}</span>
            </div>
            {cfg.issues.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md border border-status-attention/40 bg-status-attention/10 py-2 pr-2 pl-6 text-xs text-status-attention-text">
                {cfg.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Roles</p>
              {ROLES.map((r) => (
                <p key={r} className="text-xs">
                  <span className="font-semibold">{ROLE_LABEL[r]}:</span> <span className="text-muted-foreground">{ROLE_DESCRIPTION[r]}</span>
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Bitácora de accesos y actividad</CardTitle>
            <CardDescription>Últimos 30 días: inicios y cierres de sesión, intentos fallidos, acuses de alertas críticas, tickets, mensajes de monitoreo y cambios de configuración.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <AccessLog records={audit} timezone={tz} />
        </CardContent>
      </Card>
    </div>
  );
}
