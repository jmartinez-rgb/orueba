"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SEVERITY_META } from "@/components/monitoring/status";
import type { Permission } from "@/lib/auth/roles";
import { NAV_GROUPS } from "./nav";

export interface NavCounts {
  alerts: number;
  incidents: number;
  tickets: number;
  /** Bugs y sugerencias nuevos (solo el administrador los ve). */
  feedback: number;
  /** Pendientes por iniciar del arranque del mes (1 si falta el arranque). */
  novedades: number;
  alertsSeverity: Severity;
  incidentsSeverity: Severity;
  ticketsSeverity: Severity;
  novedadesSeverity: Severity;
}

export function BrandMark({ collapsed, brandName = "izzi" }: { collapsed?: boolean; brandName?: string }) {
  return (
    <Link href="/" className="pressable flex items-center gap-2.5 rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label={`${brandName} · Ir al resumen del monitoreo`}>
      <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[#0b0c0f] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.2)]">
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
          <path d="M4 20 L10 20 L13 11 L17 25 L20 16 L28 16" fill="none" stroke="var(--brand-teal)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="28" cy="16" r="2.4" fill="#D60270" />
        </svg>
      </span>
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            <span className="text-brand-teal">{brandName}</span> <span className="text-foreground">Media</span>
          </span>
          <span className="mt-1 text-[11px] font-medium text-muted-foreground">Centro de monitoreo</span>
        </span>
      )}
    </Link>
  );
}

export function NavList({ counts, permissions, collapsed, onNavigate, id }: { counts: NavCounts; permissions: Permission[]; collapsed?: boolean; onNavigate?: () => void; id?: string }) {
  const pathname = usePathname();
  return (
    <nav id={id} className="flex flex-col gap-5" aria-label="Navegación principal">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.permission || [i.permission].flat().some((p) => permissions.includes(p)));
        if (!items.length) return null;
        return (
          <div key={group.label} className="flex flex-col gap-0.5">
            {collapsed ? (
              <span className="mx-auto mb-0.5 h-px w-6 bg-sidebar-border" aria-hidden />
            ) : (
              <span className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{group.label}</span>
            )}
            {items.map((item) => {
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              const Icon = item.icon;
              const count = item.badge ? counts[item.badge] : 0;
              const sev =
                item.badge === "alerts"
                  ? counts.alertsSeverity
                  : item.badge === "tickets"
                    ? counts.ticketsSeverity
                    : item.badge === "feedback"
                      ? "ATTENTION"
                      : item.badge === "novedades"
                        ? counts.novedadesSeverity
                        : counts.incidentsSeverity;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? `${item.label}${count > 0 ? ` · ${count} pendientes` : ""}` : undefined}
                  aria-label={`${item.label}${count > 0 ? `, ${count} pendientes` : ""}`}
                  className={cn(
                    "pressable group relative flex min-h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active ? "bg-primary/[0.09] text-foreground dark:bg-primary/[0.12]" : "text-sidebar-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {active && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-primary" />}
                  <Icon aria-hidden className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} strokeWidth={active ? 2.2 : 1.9} />
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {count > 0 && (
                    <span
                      className={cn(
                        "tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                        collapsed ? "absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]" : "",
                        SEVERITY_META[sev].tint,
                        SEVERITY_META[sev].text,
                      )}
                    >
                      <span aria-hidden>{count}</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ counts, permissions, footer, brandName }: { counts: NavCounts; permissions: Permission[]; footer?: React.ReactNode; brandName?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferencia local leída tras hidratar
      setCollapsed(localStorage.getItem("immc_sidebar") === "1");
    } catch {
      /* sin storage */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("immc_sidebar", c ? "0" : "1");
      } catch {
        /* sin storage */
      }
      return !c;
    });
  };
  return (
    <aside aria-label="Panel de navegación" className={cn("sticky top-0 hidden h-dvh shrink-0 p-2 pr-0 lg:flex", collapsed ? "w-[76px]" : "w-[252px]")}>
      {/* Panel flotante de vidrio (Liquid Glass): el contenido pasa por detrás con la luz ambiental. */}
      <div className="glass flex h-full w-full flex-col overflow-hidden rounded-[22px]">
        <div className={cn("flex h-16 shrink-0 items-center border-b border-(--hairline) px-4", collapsed && "justify-center px-0")}>
          <BrandMark collapsed={collapsed} brandName={brandName} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-5 pb-5">
          <NavList id="navegacion-principal" counts={counts} permissions={permissions} collapsed={collapsed} />
        </div>
        {!collapsed && footer && <div className="mx-3 mb-3 rounded-xl border border-(--hairline) bg-background/50 p-3">{footer}</div>}
        <button
          type="button"
          onClick={toggle}
          className="pressable flex h-11 shrink-0 items-center justify-center gap-2 border-t border-(--hairline) text-xs text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          aria-expanded={!collapsed}
          aria-controls="navegacion-principal"
        >
          <PanelLeft aria-hidden className="size-4" />
          {!collapsed && "Contraer menú"}
        </button>
      </div>
    </aside>
  );
}
