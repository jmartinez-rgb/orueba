import type { ReactNode } from "react";
import type { Severity } from "@/lib/types";
import { maxSeverity } from "@/lib/anomaly-engine/severity";
import { getSnapshot } from "@/lib/services/snapshot";
import { getEnv } from "@/lib/config/env";
import { hourLabel } from "@/lib/time/tz";
import { baseSettings } from "@/lib/services/context";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { Sidebar, type NavCounts } from "./sidebar";
import { Topbar } from "./topbar";
import { AutoRefresh } from "./auto-refresh";

/** Estructura común: sidebar + barra superior. Si el snapshot falla, la app sigue navegable. */
export async function AppShell({ children }: { children: ReactNode }) {
  const env = getEnv();
  let counts: NavCounts = { alerts: 0, incidents: 0, alertsSeverity: "NORMAL", incidentsSeverity: "NORMAL" };
  let overall: Severity | null = null;
  let cutoffLabel: string | null = null;
  let timezone = baseSettings().timezone;
  let mode: "mock" | "bigquery" = env.useMockData ? "mock" : "bigquery";
  let scenario: { id: string; name: string } | null = null;
  let scenarios: Array<{ id: string; name: string }> = [];
  try {
    const snap = await getSnapshot();
    const activeAlerts = snap.state.alerts.filter((a) => a.resolvedAt === null && !a.groupedUnder && a.status !== "FALSE_POSITIVE");
    const openIncidents = snap.state.incidents.filter((i) => i.resolvedAt === null);
    counts = {
      alerts: activeAlerts.length,
      incidents: openIncidents.length,
      alertsSeverity: maxSeverity(...activeAlerts.map((a) => a.severity)),
      incidentsSeverity: maxSeverity(...openIncidents.map((i) => i.severity)),
    };
    overall = snap.overall;
    cutoffLabel = hourLabel(snap.meta.cutoffHour);
    timezone = snap.meta.timezone;
    mode = snap.meta.mode;
    scenario = snap.meta.scenario;
    scenarios = snap.meta.scenarios;
  } catch {
    /* la página mostrará el error con detalle */
  }
  const session = await getSession();
  return (
    <div className="flex min-h-dvh">
      <Sidebar
        counts={counts}
        footer={
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">{mode === "mock" ? "Datos simulados" : "BigQuery"}</p>
            <p>Evaluación cada 2 h · {timezone}</p>
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          counts={counts}
          overall={overall}
          timezone={timezone}
          cutoffLabel={cutoffLabel}
          mode={mode}
          scenario={scenario}
          scenarios={scenarios}
          role={session.role}
          userName={session.user.name}
          devAuth={session.mode === "dev"}
          canTrigger={can(session.role, "monitoring:trigger")}
        />
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-3 py-4 sm:px-5 lg:px-6">{children}</main>
      </div>
      <AutoRefresh />
    </div>
  );
}
