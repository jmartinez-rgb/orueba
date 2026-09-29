"use client";
/** Adaptado de RareUI · FeatureBadge (MIT). Insignia con destello periódico. */
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export function FeatureBadge({ badge, children, className, tone = "teal" }: { badge: string; children: React.ReactNode; className?: string; tone?: "teal" | "neutral" }) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative inline-flex items-center gap-2 overflow-hidden rounded-full border bg-card/70 py-0.5 pr-3 pl-0.5 text-xs backdrop-blur", className)}>
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute top-0 z-0 h-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-foreground/10 to-transparent"
          initial={{ left: "-100%" }}
          animate={{ left: "200%" }}
          transition={{ repeat: Infinity, repeatType: "loop", duration: 3, ease: "linear", repeatDelay: 2 }}
        />
      )}
      <span className={cn("relative z-10 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone === "teal" ? "bg-brand-teal text-[#04201e]" : "bg-foreground text-background")}>{badge}</span>
      <span className="relative z-10 font-medium text-muted-foreground">{children}</span>
    </span>
  );
}
