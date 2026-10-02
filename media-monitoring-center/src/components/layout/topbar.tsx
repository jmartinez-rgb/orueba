"use client";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight, Clock3, Menu } from "lucide-react";
import type { Severity, DataMode } from "@/lib/types";
import type { Permission, Role } from "@/lib/auth/roles";
import type { AuthMode } from "@/lib/auth/token";
import type { AuditUserKind } from "@/lib/records/audit";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SEVERITY_META, StatusDot } from "@/components/monitoring/status";
import { cn } from "@/lib/utils";
import { BrandMark, NavList, type NavCounts } from "./sidebar";
import { LiveClock } from "./live-clock";
import { RefreshButton } from "./refresh-button";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { NAV_GROUPS } from "./nav";
import { DATA_MODE_LABEL } from "@/lib/platforms/registry";

export interface TopbarProps {
  /** Marca vigente (nombre en el logo) y botón de cambio izzi | Sky. */
  brandName: string;
  brandSwitch: ReactNode;
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
  const pathname = usePathname();
  const section = NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))).find((item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)));
  const zoneLabel = p.timezone.split("/").pop()?.replaceAll("_", " ") ?? p.timezone;
  const m = p.overall ? SEVERITY_META[p.overall] : null;
  return (
    <header className="sticky top-0 z-40 px-2 pt-2 sm:px-3">
      {/* Barra de herramientas flotante de vidrio: el contenido se desplaza por debajo. */}
      <div className="glass rounded-[18px] px-2 sm:px-3">
        <div className="flex min-h-16 items-center gap-2">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-xl lg:hidden" aria-label="Abrir navegación">
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="max-w-[85vw] p-0">
              <SheetTitle className="sr-only">Navegación del monitoreo</SheetTitle>
              <SheetDescription className="sr-only">Secciones disponibles para tu cuenta en {p.brandName}.</SheetDescription>
              <div className="flex h-16 shrink-0 items-center border-b border-(--hairline) px-4 pr-12">
                <BrandMark brandName={p.brandName} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
                <NavList counts={p.counts} permissions={p.permissions} onNavigate={() => setOpen(false)} />
              </div>
              <div className="shrink-0 border-t border-(--hairline) px-4 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{DATA_MODE_LABEL[p.mode]}</p>
                <p className="mt-1">{p.timezone.replaceAll("_", " ")}</p>
              </div>
            </SheetContent>
          </Sheet>
          <div className="hidden sm:block lg:hidden">
            <BrandMark brandName={p.brandName} collapsed />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {p.brandSwitch}
          </div>

          {section && (
            <div className="mr-1 hidden min-w-0 items-center gap-2 border-l border-(--hairline) pl-3 text-xs xl:flex" aria-label="Sección actual">
              <span className="text-muted-foreground">{section.group}</span>
              <ChevronRight aria-hidden className="size-3 text-muted-foreground/60" />
              <span className="truncate font-semibold">{section.label}</span>
            </div>
          )}

          {m && p.overall && (
            <div className={cn("hidden h-7 shrink-0 items-center gap-2 rounded-full px-2.5 md:flex", m.tint)} title="Estado general de medios">
              <StatusDot severity={p.overall} pulse />
              <span className="hidden text-xs text-muted-foreground md:inline">Estado</span>
              <span className={cn("text-xs font-semibold", m.text)}>{m.label}</span>
            </div>
          )}
          {!m && <span className="hidden h-7 shrink-0 items-center rounded-full bg-status-data/12 px-2.5 text-xs font-medium text-status-data-text md:inline-flex">Evaluación pendiente</span>}
          {p.mode === "mock" && (
            <span className="hidden h-7 items-center gap-1 rounded-full bg-foreground/[0.06] px-2.5 text-xs text-muted-foreground md:inline-flex" title="Datos simulados (USE_MOCK_DATA=true)">
              Simulado · {p.scenario?.name ?? "demo"}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <div className="mr-1 hidden flex-col items-end leading-tight md:flex">
              <LiveClock timezone={p.timezone} className="tabular text-[13px] font-semibold" />
              <span className="text-[11px] text-muted-foreground">{p.cutoffLabel ? `Corte ${p.cutoffLabel} · ${zoneLabel}` : p.timezone}</span>
            </div>
            <RefreshButton canTrigger={p.canTrigger} compact={false} />
            <ThemeToggle />
            <UserMenu
              role={p.role}
              userName={p.userName}
              userKind={p.userKind}
              authMode={p.authMode}
              canViewUsers={p.permissions.includes("users:view") || p.permissions.includes("users:manage")}
              mode={p.mode}
              scenario={p.scenario?.id ?? null}
              scenarios={p.scenarios}
            />
          </div>
        </div>
        <div className="flex min-h-9 items-center justify-between gap-3 border-t border-(--hairline) px-1 pb-1 text-[11px] md:hidden">
          <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Clock3 aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{p.mode === "mock" ? `Simulado · ${p.scenario?.name ?? "demo"}` : p.cutoffLabel ? `Corte ${p.cutoffLabel} · ${zoneLabel}` : zoneLabel}</span>
          </div>
          {m && p.overall && (
            <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 font-semibold", m.tint, m.text)} title="Estado general de medios">
              <StatusDot severity={p.overall} /> {m.label}
            </span>
          )}
          {!m && <span className="shrink-0 rounded-full bg-status-data/12 px-2 py-1 font-semibold text-status-data-text">Evaluación pendiente</span>}
        </div>
      </div>
    </header>
  );
}
