"use client";
/** Adaptado de RareUI · AvatarGroup (MIT), con avatares blobatar en lugar de fotos. */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { UserAvatar } from "@/components/users/user-avatar";

export interface AvatarPerson {
  id: string;
  name: string;
  detail?: string;
}

export function AvatarGroup({ people, max = 6, caption }: { people: AvatarPerson[]; max?: number; caption?: React.ReactNode }) {
  const reduce = useReducedMotion();
  const shown = people.slice(0, max);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduce || shown.length < 2) return;
    const t = setInterval(() => setActive((i) => (i + 1) % shown.length), 2200);
    return () => clearInterval(t);
  }, [reduce, shown.length]);
  if (!shown.length) return null;
  return (
    <div className="flex items-end gap-3">
      <div className="flex h-[54px] items-end">
        <div className="flex -space-x-3">
          {shown.map((p, index) => {
            const isActive = index === active;
            return (
              <div key={p.id} className="relative">
                <AnimatePresence mode="wait">
                  {isActive && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.85 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.9 }}
                      className="absolute -top-8 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-background shadow"
                    >
                      {p.name}
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.div
                  className="relative rounded-full ring-2 ring-background"
                  animate={{ y: isActive ? -6 : 0, scale: isActive ? 1.08 : 1, zIndex: isActive ? 40 : shown.length - index }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  title={p.detail ? `${p.name} · ${p.detail}` : p.name}
                >
                  <UserAvatar name={p.name} size={36} />
                </motion.div>
              </div>
            );
          })}
          {people.length > max && (
            <span className="relative z-0 inline-flex size-9 items-center justify-center rounded-full bg-muted text-[11px] font-semibold ring-2 ring-background">+{people.length - max}</span>
          )}
        </div>
      </div>
      {caption && <div className="pb-1 text-xs text-muted-foreground">{caption}</div>}
    </div>
  );
}
