"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import type { Severity, DataMode } from "@/lib/types";
import type { Permission, Role } from "@/lib/auth/roles";
import type { AuthMode } from "@/lib/auth/token";
import type { AuditUserKind } from "@/lib/records/audit";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SEVERITY_META, StatusDot } from "@/components/monitoring/status";
import { cn } from "@/lib/utils";
import { BrandMark, NavList, type NavCounts } from "./sidebar";
import { LiveClock } from "./live-clock";
import { RefreshButton } from "./refresh-button";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export interface TopbarProps {
  counts: NavCounts;
  permissions: Permission[];
  overall: Severity | null;
  timezone: string;
  cutoffLabel: string | null;
  mode: DataMode;
  scenario: { id: string; name: string } | null;
  scenarios: Array<{ id: string; name: string }>;
  role: Role;
  userName: string;
  userKind: AuditUserKind;
  authMode: AuthMode;
  canTrigger: boolean;
}

export function Topbar(p: TopbarProps) {
  const [open, setOpen] = useState(false);
  const m = p.overall ? SEVERITY_META[p.overall] : null;
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
        <Menu />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          <div className="flex h-14 items-center border-b px-3">
            <BrandMark />
          </div>
          <div className="px-2 py-3">
            <NavList counts={p.counts} permissions={p.permissions} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      <div className="hidden sm:block lg:hidden">
        <BrandMark collapsed />
      </div>

      {m && p.overall && (
        <div className={cn("flex items-center gap-2 rounded-md border px-2 py-1", m.tint, m.border)} title="Estado general de medios">
          <StatusDot severity={p.overall} pulse />
          <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">Estado general</span>
          <span className={cn("text-xs font-bold tracking-wide", m.text)}>{m.label}</span>
        </div>
      )}
      {p.mode === "mock" && (
        <span className="hidden items-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground md:inline-flex" title="Datos simulados (USE_MOCK_DATA=true)">
          MOCK · {p.scenario?.name ?? "demo"}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <div className="hidden flex-col items-end leading-tight md:flex">
          <LiveClock timezone={p.timezone} className="tabular text-sm font-semibold" />
          <span className="text-[10px] text-muted-foreground">{p.cutoffLabel ? `Corte ${p.cutoffLabel} · ${p.timezone.split("/").pop()?.replace("_", " ")}` : p.timezone}</span>
        </div>
        <RefreshButton canTrigger={p.canTrigger} compact={false} />
        <ThemeToggle />
        <UserMenu
          role={p.role}
          userName={p.userName}
          userKind={p.userKind}
          authMode={p.authMode}
          canViewUsers={p.permissions.includes("users:view")}
          mode={p.mode}
          scenario={p.scenario?.id ?? null}
          scenarios={p.scenarios}
        />
      </div>
    </header>
  );
}
