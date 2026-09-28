import type { ReactNode } from "react";
import type { Severity } from "@/lib/types";
import { maxSeverity } from "@/lib/anomaly-engine/severity";
import { getSnapshot } from "@/lib/services/snapshot";
import { getEnv } from "@/lib/config/env";
import { hourLabel } from "@/lib/time/tz";
import { baseSettings } from "@/lib/services/context";
import { sessionPermissions, type Session } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { getAuthConfig } from "@/lib/auth/config";
import { openTicketStats } from "@/lib/records/tickets";
import { touchUser } from "@/lib/records/audit";
import { logger } from "@/lib/logging/logger";
import { Sidebar, type NavCounts } from "./sidebar";
import { Topbar } from "./topbar";
import { AutoRefresh } from "./auto-refresh";
import { CriticalAlertGate } from "@/components/monitoring/critical-alert-gate";

/** Estructura común: sidebar + barra superior. Si el snapshot falla, la app sigue navegable. */
export async function AppShell({ children, session }: { children: ReactNode; session: Session }) {
  const env = getEnv();
  let counts: NavCounts = { alerts: 0, incidents: 0, tickets: 0, alertsSeverity: "NORMAL", incidentsSeverity: "NORMAL", ticketsSeverity: "NORMAL" };
  let overall: Severity | null = null;
  let cutoffLabel: string | null = null;
  let timezone = baseSettings().timezone;
  let mode: "mock" | "bigquery" = env.useMockData ? "mock" : "bigquery";
  let scenario: { id: string; name: string } | null = null;
  let scenarios: Array<{ id: string; name: string }> = [];
  const [snapResult, tickets] = await Promise.all([
    getSnapshot().then(
      (s) => ({ ok: true as const, s }),
      () => ({ ok: false as const }),
    ),
    openTicketStats().catch(() => ({ open: 0, severity: "NORMAL" as Severity })),
    // Presencia: última vez que se vio a la persona (máximo una escritura cada 5 min).
    touchUser({ id: session.user.id, name: session.user.name, role: session.role, kind: session.user.kind }).catch((err) => logger.warn("audit.touch_failed", { error: err })),
  ]);
  if (snapResult.ok) {
    const snap = snapResult.s;
    const activeAlerts = snap.state.alerts.filter((a) => a.resolvedAt === null && !a.groupedUnder && a.status !== "FALSE_POSITIVE");
    const openIncidents = snap.state.incidents.filter((i) => i.resolvedAt === null);
    counts = {
      alerts: activeAlerts.length,
      incidents: openIncidents.length,
      tickets: tickets.open,
      alertsSeverity: maxSeverity(...activeAlerts.map((a) => a.severity)),
      incidentsSeverity: maxSeverity(...openIncidents.map((i) => i.severity)),
      ticketsSeverity: tickets.severity,
    };
    overall = snap.overall;
    cutoffLabel = hourLabel(snap.meta.cutoffHour);
    timezone = snap.meta.timezone;
    mode = snap.meta.mode;
    scenario = snap.meta.scenario;
    scenarios = snap.meta.scenarios;
  } else {
    counts = { ...counts, tickets: tickets.open, ticketsSeverity: tickets.severity };
  }
  const permissions = sessionPermissions(session);
  const auth = getAuthConfig();
  return (
    <div className="flex min-h-dvh">
      <Sidebar
        counts={counts}
        permissions={permissions}
        footer={
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">{mode === "mock" ? "Datos simulados" : "BigQuery"}</p>
            <p>Evaluación cada 2 h · {timezone}</p>
            <p className="text-[10px] leading-snug">Solo lectura: no modifica nada en las plataformas.</p>
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {auth.mode === "open" && (
          <div className="border-b border-status-attention/40 bg-status-attention/10 px-4 py-1.5 text-center text-[11px] text-status-attention-text">
            Acceso abierto (sin contraseña): configura AUTH_SECRET, AUTH_USERS y AUTH_UNIVERSAL_PASSWORD_HASH para exigir inicio de sesión.
          </div>
        )}
        <Topbar
          counts={counts}
          permissions={permissions}
          overall={overall}
          timezone={timezone}
          cutoffLabel={cutoffLabel}
          mode={mode}
          scenario={scenario}
          scenarios={scenarios}
          role={session.role}
          userName={session.user.name}
          userKind={session.user.kind}
          authMode={session.mode}
          canTrigger={can(session.role, "monitoring:trigger")}
        />
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-3 py-4 sm:px-5 lg:px-6">{children}</main>
      </div>
      <AutoRefresh />
      <CriticalAlertGate userName={session.user.name} canTicket={can(session.role, "tickets:write")} />
    </div>
  );
}
