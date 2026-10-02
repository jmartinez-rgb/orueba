import type { Alert, Incident } from "@/lib/alerts/types";
import type { AnomalyType, DailyPacing, PlatformStatusInfo } from "@/lib/monitoring/types";
import type { DataState, PlatformId, Severity } from "@/lib/types";
import type { DomainSelection } from "@/lib/domains/types";

/**
 * Vista del cliente: el estado general en lenguaje simple. Nunca incluye notas, responsables,
 * nombres de quien atiende, tickets, configuración, IDs internos ni detalle por campaña: solo si
 * todo está en orden, cómo va cada plataforma y qué se está atendiendo, en términos generales.
 */

export type ClientLevel = "ok" | "watch" | "action" | "nodata";

export interface ClientPlatform {
  platform: PlatformId;
  level: ClientLevel;
  label: string;
  /** Gasto de hoy contra lo esperado a esta hora, en % (100 = en ritmo). */
  todayPct: number | null;
  /** Avance del presupuesto del mes y lo esperado a la fecha, en %. */
  monthUsedPct: number | null;
  monthExpectedPct: number | null;
}

export interface ClientAttention {
  platform: PlatformId;
  what: string;
  since: string;
  stage: "En atención" | "En revisión";
}

export interface ClientView {
  overall: ClientLevel;
  headline: string;
  message: string;
  updatedAt: string | null;
  nextReviewAt: string;
  platforms: ClientPlatform[];
  attending: ClientAttention[];
  /** Alertas públicas de lectura: sin diagnósticos internos, responsables o notas. */
  alerts: Array<{ platform: PlatformId; severity: Severity; what: string; since: string }>;
  month: { usedPct: number | null; expectedPct: number | null } | null;
}

export interface ClientViewInput {
  platforms: PlatformId[];
  platformStatus: Record<PlatformId, Pick<PlatformStatusInfo, "severity" | "dataState">>;
  pacing: Partial<Record<PlatformId | "total", Pick<DailyPacing, "pctOfExpected">>>;
  incidents: Incident[];
  alerts?: Alert[];
  lastDataAt: string | null;
  nextEvaluationAt: string;
  /** Avance mensual por plataforma y total (de Budget Control), si hay presupuesto. */
  month: Partial<Record<PlatformId | "total", { usedPct: number | null; expectedPct: number | null }>>;
  /** The public projection contains the scope label, never its technical account IDs. */
  domain?: DomainSelection;
  hasAccounts?: boolean;
  scopeAccounts?: ReadonlyArray<{ id: string; platform: PlatformId }>;
}

const BAD_DATA: DataState[] = ["DELAYED", "ERROR", "NO_DATA", "PARTIAL"];

const WHAT: Record<AnomalyType, string> = {
  DATA_ISSUE: "Actualización de datos",
  DELIVERY_CRITICAL: "Variación en la entrega de anuncios",
  PLATFORM_INCIDENT: "Situación en la plataforma",
  DELIVERY_ISSUE: "Variación en la entrega de anuncios",
  TRACKING_ISSUE: "Revisión de la medición de resultados",
  PERFORMANCE_ISSUE: "Variación en resultados",
  EFFICIENCY_ISSUE: "Variación en eficiencia",
  OVERSPEND: "Ritmo de inversión por encima de lo planeado",
  UNDERSPEND: "Ritmo de inversión por debajo de lo planeado",
  COST_INCREASE: "Aumento de costos",
  PACING_DEVIATION: "Ritmo de inversión",
  ABSOLUTE_TOP_BELOW: "Revisión de visibilidad en búsqueda",
  ABSOLUTE_TOP_DROP: "Variación en visibilidad en búsqueda",
};

const LEVEL_LABEL: Record<ClientLevel, string> = {
  ok: "En orden",
  watch: "En observación",
  action: "Atendiendo",
  nodata: "Actualizando datos",
};

const rank: Record<ClientLevel, number> = { ok: 0, nodata: 1, watch: 2, action: 3 };

function levelOf(severity: Severity, dataState: DataState): ClientLevel {
  if (BAD_DATA.includes(dataState)) return "nodata";
  if (severity === "ALERT" || severity === "CRITICAL") return "action";
  if (severity === "ATTENTION") return "watch";
  return "ok";
}

const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100));

export function buildClientView(input: ClientViewInput): ClientView {
  const unavailableScope = input.domain?.id !== "all" && input.domain?.available === false;
  const emptyScope = unavailableScope || input.hasAccounts === false || input.platforms.length === 0;
  if (emptyScope) return {
    overall: "nodata",
    headline: unavailableScope ? "Alcance no disponible" : "Sin cuentas en este alcance",
    message: unavailableScope ? "La clasificación del alcance seleccionado no está disponible. El equipo revisará la configuración antes de interpretar sus datos." : "No hay cuentas configuradas en el alcance seleccionado. Este estado no confirma que las campañas estén en orden.",
    updatedAt: null, nextReviewAt: input.nextEvaluationAt,
    platforms: [], attending: [], alerts: [], month: null,
  };
  const accountKeys = new Set(input.scopeAccounts?.map(account => `${account.platform}:${account.id}`));
  const inScope = (row: Pick<Incident, "platform" | "accountId">) => !input.domain || input.domain.id === "all" || !!row.accountId && accountKeys.has(`${row.platform}:${row.accountId}`);
  const platforms: ClientPlatform[] = input.platforms.map((p) => {
    const st = input.platformStatus[p];
    const level = st ? levelOf(st.severity, st.dataState) : "nodata";
    const m = input.month[p];
    return {
      platform: p,
      level,
      label: LEVEL_LABEL[level],
      todayPct: pct(input.pacing[p]?.pctOfExpected),
      monthUsedPct: pct(m?.usedPct),
      monthExpectedPct: pct(m?.expectedPct),
    };
  });

  // Solo lo que el equipo atiende (desde Alerta) y sigue abierto; sin nombres, notas ni IDs.
  const attending: ClientAttention[] = input.incidents
    .filter((i) => i.resolvedAt === null && (i.maxSeverity === "ALERT" || i.maxSeverity === "CRITICAL") && input.platforms.includes(i.platform) && inScope(i))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((i) => ({
      platform: i.platform,
      what: WHAT[i.type] ?? "Revisión en curso",
      since: i.startedAt,
      stage: i.status === "ACKNOWLEDGED" || i.status === "INVESTIGATING" || i.owner ? "En atención" : "En revisión",
    }));

  const worst = platforms.reduce<ClientLevel>((acc, p) => (rank[p.level] > rank[acc] ? p.level : acc), "ok");
  const overall: ClientLevel = attending.length && rank[worst] < rank.action ? "action" : worst;
  const headline =
    overall === "ok"
      ? "Todo en orden"
      : overall === "watch"
        ? "En observación"
        : overall === "nodata"
          ? "Actualizando datos"
          : attending.length === 1
            ? "Estamos atendiendo una situación"
            : `Estamos atendiendo ${attending.length || "algunas"} situaciones`;
  const message =
    overall === "ok"
      ? "Tus campañas avanzan dentro de lo esperado en todas las plataformas monitoreadas."
      : overall === "watch"
        ? "Hay variaciones menores que el equipo está observando. No requieren acción de tu parte."
        : overall === "nodata"
          ? "Algunas plataformas aún no actualizan sus datos de hoy. El estado se completa en cuanto lleguen."
          : "El equipo ya está revisando lo detectado y te mantendrá al tanto por los canales acordados.";

  return {
    overall,
    headline,
    message,
    updatedAt: input.lastDataAt,
    nextReviewAt: input.nextEvaluationAt,
    platforms,
    attending,
    alerts: (input.alerts ?? []).filter(alert => alert.resolvedAt === null && alert.status !== "FALSE_POSITIVE" && !alert.groupedUnder && input.platforms.includes(alert.platform) && inScope(alert)).map(alert => ({ platform: alert.platform, severity: alert.severity, what: WHAT[alert.type] ?? "Revisión en curso", since: alert.detectedAt })),
    month: input.month.total ? { usedPct: pct(input.month.total.usedPct), expectedPct: pct(input.month.total.expectedPct) } : null,
  };
}
