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
  alertsSeverity: Severity;
  incidentsSeverity: Severity;
  ticketsSeverity: Severity;
}

export function BrandMark({ collapsed, brandName = "izzi" }: { collapsed?: boolean; brandName?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1" aria-label={`${brandName} Media Monitoring Center`}>
      <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0b0c0f] ring-1 ring-white/10">
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
          <path d="M4 20 L10 20 L13 11 L17 25 L20 16 L28 16" fill="none" stroke="var(--brand-teal)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="28" cy="16" r="2.4" fill="#D60270" />
        </svg>
      </span>
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[15px] font-extrabold tracking-tight">
            <span className="text-brand-teal">{brandName}</span> <span className="text-foreground">Media</span>
          </span>
          <span className="mt-0.5 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Monitoring Center</span>
        </span>
      )}
    </Link>
  );
}

export function NavList({ counts, permissions, collapsed, onNavigate }: { counts: NavCounts; permissions: Permission[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-3" aria-label="Navegación principal">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.permission || [i.permission].flat().some((p) => permissions.includes(p)));
        if (!items.length) return null;
        return (
          <div key={group.label} className="flex flex-col gap-0.5">
            {collapsed ? (
              <span className="mx-auto mb-0.5 h-px w-6 bg-sidebar-border" aria-hidden />
            ) : (
              <span className="px-2.5 pb-0.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground/80 uppercase">{group.label}</span>
            )}
            {items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              const count = item.badge ? counts[item.badge] : 0;
              const sev = item.badge === "alerts" ? counts.alertsSeverity : item.badge === "tickets" ? counts.ticketsSeverity : item.badge === "feedback" ? "ATTENTION" : counts.incidentsSeverity;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                    active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground/75 hover:bg-muted hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-brand-teal" aria-hidden />}
                  <Icon className={cn("size-4 shrink-0", active ? "text-brand-teal" : "text-muted-foreground group-hover:text-foreground")} />
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {count > 0 && (
                    <span
                      className={cn(
                        "tabular inline-flex min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold",
                        collapsed ? "absolute -top-0.5 -right-0.5 min-w-4 px-0.5" : "",
                        SEVERITY_META[sev].tint,
                        SEVERITY_META[sev].text,
                      )}
                    >
                      {count}
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
    <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex", collapsed ? "w-[60px]" : "w-[224px]")}>
      <div className={cn("flex h-14 items-center border-b border-sidebar-border px-3", collapsed && "justify-center px-0")}>
        <BrandMark collapsed={collapsed} brandName={brandName} />
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <NavList counts={counts} permissions={permissions} collapsed={collapsed} />
      </div>
      {!collapsed && footer && <div className="border-t border-sidebar-border p-3">{footer}</div>}
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 items-center justify-center gap-2 border-t border-sidebar-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
      >
        <PanelLeft className="size-4" />
        {!collapsed && "Contraer"}
      </button>
    </aside>
  );
}
