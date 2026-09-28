"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenText, FlaskConical, LogOut, UsersRound } from "lucide-react";
import { sileo } from "sileo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/auth/roles";
import type { AuthMode } from "@/lib/auth/token";
import type { AuditUserKind } from "@/lib/records/audit";
import { UserAvatar } from "@/components/users/user-avatar";

const KIND_LABEL: Record<AuditUserKind, string> = {
  named: "Cuenta nominal",
  universal: "Contraseña universal",
  open: "Acceso abierto (demo)",
  header: "Inicio de sesión corporativo",
  anon: "Sin sesión",
};

export function UserMenu({
  role,
  userName,
  userKind,
  authMode,
  canViewUsers,
  mode,
  scenario,
  scenarios,
}: {
  role: Role;
  userName: string;
  userKind: AuditUserKind;
  authMode: AuthMode;
  canViewUsers: boolean;
  mode: "mock" | "bigquery";
  scenario: string | null;
  scenarios: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  async function post(url: string, body: unknown, success?: string) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      if (success) sileo.success({ title: success });
      router.refresh();
    } else sileo.error({ title: "No se pudo aplicar el cambio" });
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-1.5" aria-label={`Usuario: ${userName}`}>
          <UserAvatar name={userName} size={26} animate />
          <span className="hidden max-w-32 flex-col items-start leading-tight xl:flex">
            <span className="truncate text-xs font-semibold">{userName}</span>
            <span className="text-[10px] text-muted-foreground">{ROLE_LABEL[role]}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center gap-3 px-2 py-2">
          <UserAvatar name={userName} size={40} animate />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</p>
            <p className="text-[10px] text-muted-foreground">{KIND_LABEL[userKind]}</p>
          </div>
        </div>
        {authMode === "open" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="normal-case tracking-normal">Rol (acceso abierto)</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={role} onValueChange={(v) => post("/api/session/role", { role: v }, `Rol: ${ROLE_LABEL[v as Role]}`)}>
              {ROLES.map((r) => (
                <DropdownMenuRadioItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {mode === "mock" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 normal-case tracking-normal">
              <FlaskConical className="size-3.5" /> Escenario simulado
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scenario ?? "default"} onValueChange={(v) => post("/api/settings/scenario", { scenario: v }, "Escenario actualizado")}>
              {scenarios.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id}>
                  {s.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        {canViewUsers && (
          <DropdownMenuItem asChild>
            <Link href="/usuarios">
              <UsersRound /> Usuarios y accesos
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/guia">
            <BookOpenText /> Guía de uso
          </Link>
        </DropdownMenuItem>
        {authMode === "password" && (
          <DropdownMenuItem onSelect={logout} className="text-status-critical-text focus:text-status-critical-text">
            <LogOut /> Cerrar sesión
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
