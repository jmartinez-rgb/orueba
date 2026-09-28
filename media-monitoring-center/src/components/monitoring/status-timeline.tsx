import type { PlatformId, Severity } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import type { RunSummary } from "@/lib/state/store";
import { hourLabel } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { isBadDataState, PlatformMark, SEVERITY_META } from "./status";

/** Histórico del día: estado de cada plataforma en cada evaluación programada. */
export function StatusTimeline({
  runs,
  slots,
  live,
}: {
  runs: RunSummary[];
  slots: number[];
  live: { cutoffHour: number; platforms: Record<PlatformId, { severity: Severity; dataState: RunSummary["platforms"][PlatformId]["dataState"] }>; overall: Severity };
}) {
  const bySlot = new Map(runs.map((r) => [r.cutoffHour, r]));
  const cols = [...slots.map((s) => ({ key: `s${s}`, label: hourLabel(s), run: bySlot.get(s) ?? null, future: !bySlot.has(s) })), { key: "live", label: "Ahora", run: null, future: false }];
  const cell = (sev: Severity | null, data: RunSummary["platforms"][PlatformId]["dataState"] | null, future: boolean, title: string) => {
    if (future) return <span className="block h-6 rounded-sm border border-dashed" title={`${title}: pendiente`} />;
    if (data && isBadDataState(data)) return <span className="block h-6 rounded-sm bg-status-data/60" title={`${title}: ${data}`} />;
    const m = SEVERITY_META[sev ?? "NORMAL"];
    return <span className={cn("block h-6 rounded-sm", m.dot, sev === "NORMAL" && "opacity-45")} title={`${title}: ${m.label}`} />;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-28 text-left text-[11px] font-medium text-muted-foreground" />
            {cols.map((c) => (
              <th key={c.key} className={cn("tabular text-center text-[10px] font-medium text-muted-foreground", c.key === "live" && "text-foreground")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-[11px] font-semibold">General</td>
            {cols.map((c) => (
              <td key={c.key}>{c.key === "live" ? cell(live.overall, null, false, "Ahora") : cell(c.run?.overall ?? null, null, c.future, c.label)}</td>
            ))}
          </tr>
          {PLATFORM_IDS.map((p) => (
            <tr key={p}>
              <td>
                <span className="flex items-center gap-1.5">
                  <PlatformMark platform={p} className="size-4 rounded text-[8px]" />
                  <span className="truncate text-[11px]">{PLATFORMS[p].shortName}</span>
                </span>
              </td>
              {cols.map((c) =>
                c.key === "live" ? (
                  <td key={c.key}>{cell(live.platforms[p].severity, live.platforms[p].dataState, false, `${PLATFORMS[p].shortName} ahora`)}</td>
                ) : (
                  <td key={c.key}>{cell(c.run?.platforms[p]?.severity ?? null, c.run?.platforms[p]?.dataState ?? null, c.future, `${PLATFORMS[p].shortName} ${c.label}`)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {(["NORMAL", "ATTENTION", "ALERT", "CRITICAL"] as Severity[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block size-2.5 rounded-sm", SEVERITY_META[s].dot, s === "NORMAL" && "opacity-45")} />
            {SEVERITY_META[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-status-data/60" /> Datos atrasados / error
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm border border-dashed" /> Pendiente
        </span>
      </div>
    </div>
  );
}
