"use client";
/** Adaptado de RareUI · AnimatedTab (MIT). Selector segmentado con indicador animado. */
import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface AnimatedTab<T extends string = string> {
  id: T;
  label: React.ReactNode;
  /** Texto para lectores de pantalla cuando `label` no es texto. */
  ariaLabel?: string;
  count?: number;
}

export function AnimatedTabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
  size = "sm",
  label,
}: {
  tabs: AnimatedTab<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
  size?: "sm" | "md";
  label: string;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<T | null>(null);
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-full border bg-muted/60 p-1 backdrop-blur", className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={tab.ariaLabel}
            onClick={() => onChange(tab.id)}
            onMouseEnter={() => setHovered(tab.id)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              "relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
              isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`${id}-pill`}
                className="absolute inset-0 -z-10 rounded-full bg-primary shadow-sm"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
              />
            )}
            {hovered === tab.id && !isActive && (
              <motion.span layoutId={`${id}-hover`} className="absolute inset-0 -z-10 rounded-full bg-foreground/5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} />
            )}
            <span className="relative">{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className={cn("tabular relative rounded-full px-1.5 text-[10px] leading-4", isActive ? "bg-primary-foreground/20" : "bg-foreground/10")}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
