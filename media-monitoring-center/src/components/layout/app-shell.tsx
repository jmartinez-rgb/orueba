import type { ReactNode } from "react";
import type { Severity } from "@/lib/types";
import { maxSeverity } from "@/lib/anomaly-engine/severity";
import { cookies } from "next/headers";
import { getBrandStatus, getSnapshot } from "@/lib/services/snapshot";
import { BRAND_COOKIE, BRAND_IDS, BRANDS, parseBrand, type BrandId } from "@/lib/brands";
import { BrandSwitch, type BrandStatus } from "./brand-switch";
import { getEnv } from "@/lib/config/env";
import { hourLabel } from "@/lib/time/tz";
import { baseSettings } from "@/lib/services/context";
import { sessionPermissions, type Session, hasPermission } from "@/lib/auth/session";
import { getAuthConfig } from "@/lib/auth/config";
import { mustAcknowledgeCritical } from "@/lib/auth/roles";
import { openTicketStats } from "@/lib/records/tickets";
import { newFeedbackCount } from "@/lib/records/feedback";
import { touchUser } from "@/lib/records/audit";
import { logger } from "@/lib/logging/logger";
import { Sidebar, type NavCounts } from "./sidebar";
import { Topbar } from "./topbar";
import { AutoRefresh } from "./auto-refresh";
import { CriticalAlertGate } from "@/components/monitoring/critical-alert-gate";
import { MonthGate } from "@/components/novedades/month-gate";
import { getKickoff } from "@/lib/records/novedades";
import { DATA_MODE_LABEL } from "@/lib/platforms/registry";
import type { DataMode } from "@/lib/types";

/** Estructura común: sidebar + barra superior. Si el snapshot falla, la app sigue navegable. */
export async function AppShell({ children, session }: { children: ReactNode; session: Session }) {
  const env = getEnv();
  let counts: NavCounts = { alerts: 0, incidents: 0, tickets: 0, feedback: 0, novedades: 0, alertsSeverity: "NORMAL", incidentsSeverity: "NORMAL", ticketsSeverity: "NORMAL", novedadesSeverity: "NORMAL" };
  let overall: Severity | null = null;
  let cutoffLabel: string | null = null;
  let timezone = baseSettings().timezone;
  let mode: DataMode = env.dataSource;
  let scenario: { id: string; name: string } | null = null;
  let scenarios: Array<{ id: string; name: string }> = [];
  const canManageFeedback = hasPermission(session, "feedback:manage");
  const allowedBrands: BrandId[] = session.brands.length ? session.brands : BRAND_IDS;
  const wantedBrand = parseBrand((await cookies()).get(BRAND_COOKIE)?.value);
  let brand: BrandId = allowedBrands.includes(wantedBrand) ? wantedBrand : allowedBrands[0];
  let brandHasData = true;
  const [snapResult, tickets, feedbackNew] = await Promise.all([
    getSnapshot().then(
      (s) => ({ ok: true as const, s }),
      () => ({ ok: false as const }),
    ),
    openTicketStats(brand).catch(() => ({ open: 0, severity: "NORMAL" as Severity })),
    canManageFeedback ? newFeedbackCount().catch(() => 0) : Promise.resolve(0),
    // Presencia: última vez que se vio a la persona (máximo una escritura cada 5 min).
    touchUser({ id: session.user.id, name: session.user.name, role: session.role, kind: session.user.kind }).catch((err) => logger.warn("audit.touch_failed", { error: err })),
  ]);
  if (snapResult.ok) {
    const snap = snapResult.s;
    const activeAlerts = snap.state.alerts.filter((a) => a.resolvedAt === null && !a.groupedUnder && a.status !== "FALSE_POSITIVE");
    const openIncidents = snap.state.incidents.filter((i) => i.resolvedAt === null);
    // Novedades: pendientes por iniciar del arranque del mes (o 1 si el arranque falta).
    const kickoff = await getKickoff(snap.meta.brand.id, snap.run.businessDate.slice(0, 7)).catch(() => null);
    const pendingStarts = kickoff ? kickoff.items.filter((i) => i.state === "PENDING" && !i.startedAt).length : 0;
    counts = {
      alerts: activeAlerts.length,
      incidents: openIncidents.length,
      tickets: tickets.open,
      feedback: feedbackNew,
      novedades: kickoff ? pendingStarts : 1,
      alertsSeverity: maxSeverity(...activeAlerts.map((a) => a.severity)),
      incidentsSeverity: maxSeverity(...openIncidents.map((i) => i.severity)),
      ticketsSeverity: tickets.severity,
      novedadesSeverity: kickoff ? "ATTENTION" : "ALERT",
    };
    overall = snap.overall;
    cutoffLabel = hourLabel(snap.meta.cutoffHour);
    timezone = snap.meta.timezone;
    mode = snap.meta.mode;
    scenario = snap.meta.scenario;
    scenarios = snap.meta.scenarios;
    brand = snap.meta.brand.id;
    brandHasData = snap.meta.brandHasData;
  } else {
    counts = { ...counts, tickets: tickets.open, feedback: feedbackNew, ticketsSeverity: tickets.severity };
  }
  const permissions = sessionPermissions(session);
  const auth = getAuthConfig();
  // Estado de cada marca para el botón de cambio (la vigente sale del snapshot; las otras, en caché por minuto).
  const brandStatuses: BrandStatus[] =
    allowedBrands.length > 1
      ? (
          await Promise.all(
            allowedBrands.map((b) =>
              b === brand && snapResult.ok
                ? Promise.resolve({ brand: b, overall: snapResult.s.meta.brandHasData ? snapResult.s.overall : null, critical: snapResult.s.state.incidents.filter((i) => i.resolvedAt === null && i.severity === "CRITICAL").length })
                : getBrandStatus(b),
            ),
          )
        ).filter((x): x is BrandStatus => x !== null)
      : [];
  return (
    <div className="flex min-h-dvh">
      <Sidebar
        brandName={BRANDS[brand].name}
        counts={counts}
        permissions={permissions}
        footer={
          <div className="space-y-0.5 text-[11px] leading-snug text-muted-foreground">
            <p className="font-medium text-foreground">{DATA_MODE_LABEL[mode]}</p>
            <p>Evaluación cada 2 h · {timezone.replace("_", " ")}</p>
            <p>Solo lectura: no modifica nada en las plataformas.</p>
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {auth.mode === "open" && (
          <div className="border-b border-(--hairline) bg-status-attention/12 px-4 py-1.5 text-center text-xs text-status-attention-text">
            Acceso abierto (sin contraseña): configura AUTH_SECRET, AUTH_USERS y AUTH_UNIVERSAL_PASSWORD_HASH para exigir inicio de sesión.
          </div>
        )}
        <Topbar
          brandName={BRANDS[brand].name}
          brandSwitch={<BrandSwitch current={brand} statuses={brandStatuses} />}
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
          canTrigger={hasPermission(session, "monitoring:trigger")}
        />
        {!brandHasData && (
          <div className="border-b border-(--hairline) bg-status-attention/12 px-4 py-1.5 text-center text-xs text-status-attention-text">
            La fuente de datos no trae cuentas de {BRANDS[brand].name}. Las cuentas se asignan por su nombre (por ejemplo &quot;Sky - ABCW&quot; o &quot;izzi - Ofertas&quot;).
          </div>
        )}
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-5 pb-10 sm:px-6 lg:px-7">{children}</main>
      </div>
      <AutoRefresh />
      {mustAcknowledgeCritical(session.role) && hasPermission(session, "tickets:write") && <CriticalAlertGate userName={session.user.name} canTicket={hasPermission(session, "tickets:write")} />}
      <MonthGate key={brand} canKickoff={hasPermission(session, "kickoff:write")} userId={session.user.id} />
    </div>
  );
}
