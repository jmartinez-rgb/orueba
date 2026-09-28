"use client";
import { useRouter } from "next/navigation";
import { FlaskConical, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/lib/auth/roles";
import { ROLE_LABEL } from "@/lib/auth/roles";

export function UserMenu({
  role,
  userName,
  devAuth,
  mode,
  scenario,
  scenarios,
}: {
  role: Role;
  userName: string;
  devAuth: boolean;
  mode: "mock" | "bigquery";
  scenario: string | null;
  scenarios: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  async function post(url: string, body: unknown) {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-2" aria-label="Usuario y modo">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted">
            <UserRound className="size-3.5" />
          </span>
          <span className="hidden text-xs xl:inline">{ROLE_LABEL[role]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{userName}</DropdownMenuLabel>
        {devAuth ? (
          <>
            <DropdownMenuLabel className="pt-0 normal-case tracking-normal">Rol (modo desarrollo)</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={role} onValueChange={(v) => post("/api/session/role", { role: v })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <DropdownMenuRadioItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : (
          <DropdownMenuLabel className="pt-0 normal-case tracking-normal">{ROLE_LABEL[role]}</DropdownMenuLabel>
        )}
        {mode === "mock" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 normal-case tracking-normal">
              <FlaskConical className="size-3.5" /> Escenario simulado
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scenario ?? "default"} onValueChange={(v) => post("/api/settings/scenario", { scenario: v })}>
              {scenarios.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id}>
                  {s.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
