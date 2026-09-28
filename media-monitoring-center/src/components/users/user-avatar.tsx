"use client";
import { Blobatar } from "@blobatar/react";
import "blobatar/motion.css";
import { cn } from "@/lib/utils";

/**
 * Avatar determinista (blobatar): el mismo nombre siempre genera la misma figura, sin fotos
 * ni servicios externos. Cada persona queda identificada visualmente en la app y en la bitácora.
 */
export function UserAvatar({ name, size = 28, animate = false, className, title }: { name: string; size?: number; animate?: boolean; className?: string; title?: string }) {
  const seed = name.trim() || "?";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted ring-1 ring-border", className)} style={{ width: size, height: size }}>
      {animate ? (
        <Blobatar name={seed} size={size} background="circle" animate="hover" aria-hidden />
      ) : (
        <Blobatar name={seed} size={size} background="circle" alt={title ?? ""} aria-hidden={title ? undefined : true} />
      )}
    </span>
  );
}
