"use client";
/** Adaptado de RareUI · FeatureBadge (MIT). Insignia con destello periódico. */
import { cn } from "@/lib/utils";

export function FeatureBadge({ badge, children, className, tone = "teal" }: { badge: string; children: React.ReactNode; className?: string; tone?: "teal" | "neutral" }) {
  return (
    <span className={cn("relative inline-flex items-center gap-2 overflow-hidden rounded-full border bg-card/70 py-0.5 pr-3 pl-0.5 text-xs backdrop-blur", className)}>
        <span
          aria-hidden
          className="immc-feature-glint pointer-events-none absolute top-0 z-0 h-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-foreground/10 to-transparent motion-reduce:hidden"
        />
      <span className={cn("relative z-10 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone === "teal" ? "bg-primary text-primary-foreground" : "bg-foreground text-background")}>{badge}</span>
      <span className="relative z-10 font-medium text-muted-foreground">{children}</span>
    </span>
  );
}
