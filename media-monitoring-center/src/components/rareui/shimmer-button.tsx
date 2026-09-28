"use client";
/** Adaptado de RareUI · GlassShimmerButton (MIT). */
import { cn } from "@/lib/utils";

export function ShimmerButton({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "group relative inline-flex h-10 items-center justify-center gap-2 overflow-hidden rounded-full border border-white/10 px-6 text-sm font-semibold",
        "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(0,0,0,0.12)] transition-all duration-300 hover:brightness-110 active:scale-[0.98]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
    >
      <span aria-hidden className="immc-shimmer pointer-events-none absolute inset-0 h-full w-[200%] -translate-x-1/2 bg-linear-to-r from-transparent via-white/35 to-transparent" />
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/40 to-transparent opacity-60" />
      <span className="relative z-10 inline-flex items-center gap-2 tracking-wide">{children}</span>
    </button>
  );
}
