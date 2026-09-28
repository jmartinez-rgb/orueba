"use client";
/** Adaptado de RareUI · LoadingSpinner (MIT). */
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export function LoadingSpinner({ label = "Cargando…", className, size = 24 }: { label?: string | null; className?: string; size?: number }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("flex items-center gap-3", className)} role="status" aria-live="polite">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg viewBox="0 0 18 18" className="absolute size-full text-muted" aria-hidden>
          <circle cx="9" cy="9" r="7.25" fill="none" strokeWidth="2" stroke="currentColor" />
        </svg>
        <motion.div className="absolute size-full" animate={reduce ? undefined : { rotate: 360 }} transition={{ repeat: Infinity, ease: "linear", duration: 1 }}>
          <svg viewBox="0 0 18 18" className="absolute size-full text-brand-teal" aria-hidden>
            <path d="M 16.25 9 C 16.25 10.07 16.018 11.086 15.602 12 C 15.163 12.965 14.518 13.817 13.724 14.5" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
          </svg>
          <svg viewBox="0 0 18 18" className="absolute size-full text-brand-teal opacity-60 blur-[2px]" aria-hidden>
            <path d="M 16.25 9 C 16.25 10.07 16.018 11.086 15.602 12 C 15.163 12.965 14.518 13.817 13.724 14.5" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
          </svg>
        </motion.div>
      </div>
      {label && (
        <motion.span
          className="block bg-linear-to-r from-foreground via-muted-foreground to-foreground bg-clip-text text-sm font-medium text-transparent"
          initial={{ backgroundPosition: "200% 0" }}
          animate={reduce ? undefined : { backgroundPosition: "-200% 0" }}
          transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
          style={{ backgroundSize: "200% auto" }}
        >
          {label}
        </motion.span>
      )}
    </div>
  );
}
