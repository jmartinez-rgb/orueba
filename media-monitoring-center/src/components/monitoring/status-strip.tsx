import Link from "next/link";
import type { PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { PlatformCardVM } from "@/lib/services/view-models";
import { cn } from "@/lib/utils";
import { DATA_STATE_META, DeltaText, isBadDataState, PlatformMark, SEVERITY_META, StatusDot } from "./status";

/** Google 🟢 · Meta 🔴 · TikTok 🟢 ... en una sola fila. */
export function StatusStrip({ cards, attention }: { cards: Record<PlatformId, PlatformCardVM>; attention: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {PLATFORM_IDS.filter((p) => cards[p]).map((p) => {
        const c = cards[p];
        const bad = isBadDataState(c.dataState);
        const m = SEVERITY_META[c.severity];
        return (
          <Link key={p} href={`/platforms/${p}`} className={cn("flex items-center gap-2.5 surface rounded-xl px-4 py-3 hover:shadow-(--shadow-card-hover)", !bad && c.severity !== "NORMAL" && m.tint, !bad && m.border)}>
            <PlatformMark platform={p} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{c.name.replace(" Advertising", "").replace(" Ads", "")}</p>
              <p className="flex items-center gap-1.5 text-[11px]">
                {bad ? (
                  <span className="font-semibold text-status-data-text">{DATA_STATE_META[c.dataState].label}</span>
                ) : (
                  <>
                    <StatusDot severity={c.severity} pulse />
                    <span className={cn("font-semibold", m.text)}>{m.label}</span>
                  </>
                )}
              </p>
            </div>
            {!bad && <DeltaText value={c.spend.deviation} className="text-xs" attention={attention} />}
          </Link>
        );
      })}
    </div>
  );
}
