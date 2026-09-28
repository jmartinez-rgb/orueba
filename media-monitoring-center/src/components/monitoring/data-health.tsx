import type { PlatformId } from "@/lib/types";
import { PLATFORM_IDS } from "@/lib/types";
import type { PlatformDataHealth } from "@/lib/monitoring/data-health";
import { PLATFORMS } from "@/lib/platforms/registry";
import { formatTimeInTz, hourLabel } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataStateBadge, PlatformMark } from "./status";

const CHECK_TONE = { OK: "text-status-normal-text", WARN: "text-status-attention-text", FAIL: "text-status-critical-text" };

/** Last data received por plataforma. */
export function FreshnessList({ health, timezone }: { health: Record<PlatformId, PlatformDataHealth>; timezone: string }) {
  return (
    <ul className="divide-y">
      {PLATFORM_IDS.map((p) => {
        const h = health[p];
        return (
          <li key={p} className="flex items-center gap-2.5 py-2">
            <PlatformMark platform={p} className="size-5 text-[9px]" />
            <span className="flex-1 truncate text-xs font-medium">{PLATFORMS[p].shortName}</span>
            <span className="tabular text-sm font-semibold">{formatTimeInTz(h.lastDataAt, timezone)}</span>
            <span className="tabular w-16 text-right text-[11px] text-muted-foreground">{h.lagMinutes === null ? "—" : h.lagMinutes < 60 ? `${h.lagMinutes} min` : `${Math.floor(h.lagMinutes / 60)} h ${h.lagMinutes % 60} m`}</span>
            <DataStateBadge state={h.state} className="w-[96px] justify-center" />
          </li>
        );
      })}
    </ul>
  );
}

export function DataHealthTable({ health, timezone }: { health: Record<PlatformId, PlatformDataHealth>; timezone: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Plataforma</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Último dato</TableHead>
          <TableHead>Última sync</TableHead>
          <TableHead>Corte efectivo</TableHead>
          <TableHead>Salud</TableHead>
          <TableHead className="min-w-[320px]">Validaciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {PLATFORM_IDS.map((p) => {
          const h = health[p];
          return (
            <TableRow key={p}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <PlatformMark platform={p} className="size-5 text-[9px]" />
                  <span className="font-medium">{PLATFORMS[p].shortName}</span>
                </span>
              </TableCell>
              <TableCell>
                <DataStateBadge state={h.state} />
              </TableCell>
              <TableCell className="tabular">
                {formatTimeInTz(h.lastDataAt, timezone)} <span className="text-xs text-muted-foreground">({h.lagMinutes ?? "—"} min)</span>
              </TableCell>
              <TableCell className="tabular">
                {formatTimeInTz(h.lastSyncAt, timezone)}{" "}
                <span className={cn("text-xs", h.lastSyncStatus === "FAILED" ? "text-status-critical-text" : "text-muted-foreground")}>{h.lastSyncStatus}</span>
              </TableCell>
              <TableCell className="tabular">{hourLabel(h.effectiveCutoffHour)}</TableCell>
              <TableCell>
                <span className={cn("tabular font-semibold", h.score >= 90 ? "text-status-normal-text" : h.score >= 70 ? "text-status-attention-text" : "text-status-critical-text")}>{h.score}</span>
                <span className="text-xs text-muted-foreground">/100</span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {h.checks.map((c) => (
                    <span key={c.id} title={c.detail} className="inline-flex items-center gap-1">
                      <span className={cn("font-bold", CHECK_TONE[c.status])}>{c.status === "OK" ? "✓" : c.status === "WARN" ? "!" : "✕"}</span>
                      <span className={c.status === "OK" ? "text-muted-foreground" : "text-foreground"}>{c.label}</span>
                    </span>
                  ))}
                </div>
                {h.checks
                  .filter((c) => c.status !== "OK")
                  .map((c) => (
                    <p key={c.id} className={cn("mt-1 text-[11px]", CHECK_TONE[c.status])}>
                      {c.label}: {c.detail}
                    </p>
                  ))}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
