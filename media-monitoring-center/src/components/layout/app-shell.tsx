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
import { getViewContext } from "@/lib/services/context";
import { DomainSwitch } from "./domain-switch";
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
import { OperationalGates } from "@/components/monitoring/operational-gates";
import { NexusAssistant } from "@/components/nexus/nexus-assistant";
import { getKickoff } from "@/lib/records/novedades";
import { DATA_MODE_LABEL } from "@/lib/platforms/registry";
import { isBadDataState } from "@/components/monitoring/status";
import type { DataMode } from "@/lib/types";
import { Clock3, Database, Eye } from "lucide-react";

/** Estructura común: sidebar + barra superior. Si el snapshot falla, la app sigue navegable. */
export async function AppShell({ children, session }: { children: ReactNode; session: Session }) {
  const env = getEnv();
  let counts: NavCounts = { alerts: 0, incidents: 0, tickets: 0, feedback: 0, novedades: 0, alertsSeverity: "NORMAL", incidentsSeverity: "NORMAL", ticketsSeverity: "NORMAL", novedadesSeverity: "NORMAL" };
  let overall: Severity | null = null;
  let cutoffLabel: string | null = null;
  const defaults = baseSettings();
  let timezone = defaults.timezone;
  let intervalHours = defaults.schedule.intervalHours;
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
    overall = snap.overall === "NORMAL" && !snap.run.platforms.some((platform) => !isBadDataState(snap.platformStatus[platform].dataState)) ? null : snap.overall;
    cutoffLabel = hourLabel(snap.meta.cutoffHour);
    timezone = snap.meta.timezone;
    intervalHours = snap.meta.intervalHours;
    mode = snap.meta.mode;
    scenario = snap.meta.scenario;
    scenarios = snap.meta.scenarios;
    brand = snap.meta.brand.id;
    brandHasData = snap.meta.brandHasData;
  } else {
    counts = { ...counts, tickets: tickets.open, feedback: feedbackNew, ticketsSeverity: tickets.severity };
  }
  const permissions = sessionPermissions(session);
  const viewContext = await getViewContext().catch(() => null);
  const domain = viewContext?.domain;
  const domainOptions = [{ id: "all", name: "Todos los dominios" }, ...(viewContext?.domainConfig?.domains ?? []).map(({ id, name }) => ({ id, name })), ...(viewContext?.domainConfig ? [{ id: "unclassified", name: "Sin clasificar" }] : [])];
  const auth = getAuthConfig();
  // Estado de cada marca para el botón de cambio (la vigente sale del snapshot; las otras, en caché por minuto).
  const brandStatuses: BrandStatus[] =
    allowedBrands.length > 1
      ? (
          await Promise.all(
            allowedBrands.map((b) => getBrandStatus(b)),
          )
        ).filter((x): x is BrandStatus => x !== null)
      : [];
  return (
    <div className="flex min-h-dvh">
      <a href="#contenido-principal" className="sr-only z-50 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-(--shadow-pop) outline-none focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background">
        Saltar al contenido principal
      </a>
      <Sidebar
        brandName={BRANDS[brand].name}
        counts={counts}
        permissions={permissions}
        footer={
          <div className="space-y-2 text-[11px] leading-snug text-muted-foreground">
            <p className="flex items-center gap-2 font-semibold text-foreground"><Database aria-hidden className="size-3.5 text-primary" />{DATA_MODE_LABEL[mode]}</p>
            <p className="flex items-start gap-2"><Clock3 aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>Evaluación cada {intervalHours} h<br />{timezone.replaceAll("_", " ")}</span></p>
            <p className="flex items-start gap-2"><Eye aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>Consulta de plataformas en modo lectura.</span></p>
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
          domainSwitch={brand === "izzi" && domain ? <DomainSwitch current={domain} options={domainOptions} enabled={!!viewContext?.domainConfig} /> : undefined}
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
            La fuente de datos no trae cuentas de {BRANDS[brand].name}. {mode === "unified" ? "Revisa el mapeo de cuentas autorizadas y el histórico importado de esta marca." : "Las cuentas se asignan por su nombre (por ejemplo Sky - ABCW o izzi - Ofertas)."}
          </div>
        )}
        {brand === "izzi" && !viewContext?.domainConfig && <div className="border-b border-(--hairline) bg-status-attention/12 px-4 py-2 text-xs text-status-attention-text">Clasificación de dominios pendiente: el extractor necesita guardar la configuración maestra validada de la API. Absolute Top permanece sin evaluación.</div>}
        {domain && domain.id !== "all" && <div className="border-b border-(--hairline) bg-primary/5 px-4 py-2 text-xs text-foreground">Vista: Google Ads · {domain.name}{!domain.available ? " · configuración no disponible" : ""}. Las métricas representan únicamente las cuentas de este alcance.</div>}
        <main id="contenido-principal" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 scroll-mt-28 px-4 pt-5 pb-10 outline-none sm:px-6 lg:px-7">{children}</main>
      </div>
      <AutoRefresh />
      {hasPermission(session, "internal:view") && <NexusAssistant key={`nexus:${viewContext?.scopeKey ?? brand}`} brandId={brand} brandName={BRANDS[brand].name} domainId={domain?.id ?? "all"} domainName={domain?.name} />}
      <OperationalGates key={`gates:${brand}`} userName={session.user.name} userId={session.user.id} canAcknowledgeCritical={mustAcknowledgeCritical(session.role) && hasPermission(session, "tickets:write")} canTicket={hasPermission(session, "tickets:write")} canKickoff={hasPermission(session, "kickoff:write")} />
    </div>
  );
}
