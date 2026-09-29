"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import type { Recommendation } from "@/lib/optimizations/catalog";
import { AnimatedTabs } from "@/components/rareui/animated-tabs";
import { PlatformMark } from "@/components/monitoring/status";

export function RecommendationCard({ rec, context }: { rec: Recommendation; context?: string }) {
  return (
    <article className="flex flex-col gap-2 surface rounded-xl p-3.5">
      <div className="flex items-start gap-2">
        <PlatformMark platform={rec.platform} className="size-5 text-[9px]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold">{rec.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {PLATFORMS[rec.platform].name} · {rec.area}
          </p>
        </div>
      </div>
      {context && <p className="rounded-md bg-status-attention/10 px-2 py-1 text-[11px] font-medium text-status-attention-text">{context}</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">{rec.why}</p>
      <p className="text-xs leading-relaxed">
        <span className="font-semibold">Qué revisar: </span>
        {rec.check}
      </p>
      <ul className="mt-auto space-y-0.5 border-t pt-2">
        {rec.sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
              <ExternalLink className="size-3" /> {s.label}
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function RecommendationsByPlatform({ recommendations }: { recommendations: Recommendation[] }) {
  const [platform, setPlatform] = useState<PlatformId | "all">("all");
  const list = platform === "all" ? recommendations : recommendations.filter((r) => r.platform === platform);
  return (
    <div className="space-y-3">
      <AnimatedTabs
        label="Plataforma"
        active={platform}
        onChange={setPlatform}
        tabs={[{ id: "all", label: "Todas", count: recommendations.length }, ...PLATFORM_IDS.map((p) => ({ id: p, label: PLATFORMS[p].shortName, count: recommendations.filter((r) => r.platform === p).length }))]}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => (
          <RecommendationCard key={r.id} rec={r} />
        ))}
      </div>
    </div>
  );
}
