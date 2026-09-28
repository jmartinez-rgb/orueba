"use client";
import type { UserDirectoryEntry } from "@/lib/records/audit";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StateMessage } from "@/components/monitoring/states";
import { UserAvatar } from "./user-avatar";

const KIND: Record<string, string> = { named: "Cuenta", universal: "Universal", open: "Abierto", header: "SSO", anon: "—" };

export function PeopleTable({ users, timezone, nowMs }: { users: UserDirectoryEntry[]; timezone: string; nowMs: number }) {
  if (!users.length) return <StateMessage kind="empty" compact title="Aún no hay accesos registrados" description="Aparecerán aquí en cuanto alguien inicie sesión." />;
  const now = nowMs;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Persona</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Último acceso</TableHead>
            <TableHead>Última actividad</TableHead>
            <TableHead className="text-right">Accesos</TableHead>
            <TableHead>Dispositivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const online = now - new Date(u.lastSeenAt).getTime() < 30 * 60 * 1000;
            return (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="relative">
                      <UserAvatar name={u.name} size={30} />
                      {online && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-status-normal ring-2 ring-card" title="Activo" />}
                    </span>
                    <span className="font-medium">{u.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{KIND[u.kind] ?? u.kind}</TableCell>
                <TableCell className="text-xs">{u.role ? ROLE_LABEL[u.role] : "—"}</TableCell>
                <TableCell className="tabular text-xs">{u.lastLoginAt ? formatDateTimeInTz(u.lastLoginAt, timezone) : "—"}</TableCell>
                <TableCell className="tabular text-xs">{formatDateTimeInTz(u.lastSeenAt, timezone)}</TableCell>
                <TableCell className="tabular text-right text-xs">{u.logins}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{u.lastAgent ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
