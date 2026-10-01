"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LayoutDashboard, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";
import type { AuditUserKind } from "@/lib/records/audit";
import { UserAvatar } from "@/components/users/user-avatar";
import { ChangePasswordDialog } from "@/components/users/change-password-dialog";

/** Menú de usuario de la vista del cliente: contraseña, salir y, para el equipo, volver al monitoreo. */
export function ClientUserMenu({ role, userName, userKind, internal }: { role: Role; userName: string; userKind: AuditUserKind; internal: boolean }) {
  const router = useRouter();
  const [passwordOpen, setPasswordOpen] = useState(false);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 rounded-full pr-3 pl-1" aria-label={`Cuenta de ${userName}`}>
            <UserAvatar name={userName} size={28} />
            <span className="hidden max-w-36 truncate text-[13px] sm:inline">{userName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span className="block truncate">{userName}</span>
            <span className="block text-xs font-normal text-muted-foreground">{ROLE_LABEL[role]}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {internal && (
            <DropdownMenuItem asChild>
              <Link href="/">
                <LayoutDashboard className="size-4" aria-hidden /> Volver al monitoreo
              </Link>
            </DropdownMenuItem>
          )}
          {userKind === "named" && (
            <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
              <KeyRound className="size-4" aria-hidden /> Cambiar contraseña
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={logout}>
            <LogOut className="size-4" aria-hidden /> Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {userKind === "named" && <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />}
    </>
  );
}
