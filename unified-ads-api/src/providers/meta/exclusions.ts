import type { Cell, XlsxSheet } from "../../utils/xlsx.js";
import { metaObject } from "./types.js";

/**
 * Revisión de públicos excluidos en grupos de anuncios de Meta: qué cuentas, campañas y grupos
 * excluyen la audiencia de clientes activos y cuáles no. Solo considera campañas activas: grupos
 * con estado efectivo Activo cuya fecha de fin (propia o de la campaña) no ha pasado. Usa el ID y
 * el nombre de cada audiencia tal como aparecen en la segmentación; nunca consulta datos de personas.
 */

export interface MetaAudienceRef {
  id: string;
  name: string;
}

export interface MetaAdSetTargeting {
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  campaignStopTime: string;
  adSetId: string;
  adSetName: string;
  adSetStatus: string;
  startTime: string;
  endTime: string;
  optimizationGoal: string;
  destinationType: string;
  excluded: MetaAudienceRef[];
  included: MetaAudienceRef[];
  /** Audiencia Advantage+: las inclusiones son sugerencias; las exclusiones siguen aplicando. */
  advantageAudience: boolean | null;
}

export interface MetaAccountRead {
  accountId: string;
  accountName: string;
  /** account_status numérico de Meta (1 = activa); null si no se pudo leer. */
  accountStatus?: number | null;
  error: string | null;
}

/** Nombres de audiencia que cuentan como clientes activos, comparados sin acentos ni mayúsculas. */
export const DEFAULT_ACTIVE_CUSTOMER_PATTERN = "client.*activ|activ.*client";

export const ADSET_FIELDS = [
  "id",
  "name",
  "effective_status",
  "start_time",
  "end_time",
  "optimization_goal",
  "destination_type",
  "campaign{id,name,effective_status,stop_time}",
  "targeting{custom_audiences,excluded_custom_audiences,targeting_automation}",
].join(",");
/** Respaldo si Meta no acepta subcampos de targeting: pide la segmentación completa en páginas chicas. */
export const ADSET_FIELDS_FULL_TARGETING = ADSET_FIELDS.replace(/targeting\{[^}]*\}/, "targeting");

/** Solo grupos encendidos: con la campaña pausada Meta los reporta como CAMPAIGN_PAUSED. */
export const ACTIVE_ADSET_FILTER = JSON.stringify(["ACTIVE"]);

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function audiencePattern(source = DEFAULT_ACTIVE_CUSTOMER_PATTERN): RegExp {
  return new RegExp(normalizeName(source), "i");
}

export function isCapiWhatsApp(campaignName: string): boolean {
  const name = normalizeName(campaignName);
  return name.includes("capi") && name.includes("whatsapp");
}

const STATUS: Record<string, string> = {
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  CAMPAIGN_PAUSED: "Campaña pausada",
  ADSET_PAUSED: "Grupo pausado",
  IN_PROCESS: "En proceso",
  WITH_ISSUES: "Con problemas",
  ARCHIVED: "Archivado",
  DELETED: "Eliminado",
};
export const statusLabel = (status: string) => STATUS[status] ?? status;

const ACCOUNT_STATUS: Record<number, string> = {
  1: "Activa",
  2: "Deshabilitada",
  3: "Con saldo pendiente",
  7: "En revisión de riesgo",
  8: "Liquidación pendiente",
  9: "En periodo de gracia",
  100: "Cierre pendiente",
  101: "Cerrada",
  201: "Activa",
  202: "Cerrada",
};
export const accountStatusLabel = (status: number | null | undefined) =>
  status === null || status === undefined ? "" : (ACCOUNT_STATUS[status] ?? String(status));

const ended = (time: string, now: number) => {
  const at = time ? Date.parse(time) : Number.NaN;
  return Number.isFinite(at) && at <= now;
};

/** Activo de verdad: estado Activo, campaña activa y sin fecha de fin vencida en el grupo ni en la campaña. */
export function isRunning(row: MetaAdSetTargeting, now = Date.now()): boolean {
  return (
    row.adSetStatus === "ACTIVE" &&
    (row.campaignStatus === "" || row.campaignStatus === "ACTIVE") &&
    !ended(row.endTime, now) &&
    !ended(row.campaignStopTime, now)
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function audiences(value: unknown): MetaAudienceRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(metaObject).map((a) => ({ id: text(a.id), name: text(a.name) || text(a.id) }));
}

export function parseAdSet(raw: Record<string, unknown>, account: { id: string; name: string }): MetaAdSetTargeting {
  const campaign: Record<string, unknown> = metaObject(raw.campaign) ? raw.campaign : {};
  const targeting: Record<string, unknown> = metaObject(raw.targeting) ? raw.targeting : {};
  const automation = metaObject(targeting.targeting_automation) ? targeting.targeting_automation : null;
  return {
    accountId: account.id,
    accountName: account.name,
    campaignId: text(campaign.id) || text(raw.campaign_id),
    campaignName: text(campaign.name),
    campaignStatus: text(campaign.effective_status),
    campaignStopTime: text(campaign.stop_time),
    adSetId: text(raw.id),
    adSetName: text(raw.name),
    adSetStatus: text(raw.effective_status),
    startTime: text(raw.start_time),
    endTime: text(raw.end_time),
    optimizationGoal: text(raw.optimization_goal),
    destinationType: text(raw.destination_type),
    excluded: audiences(targeting.excluded_custom_audiences),
    included: audiences(targeting.custom_audiences),
    advantageAudience: automation ? automation.advantage_audience === 1 || automation.advantage_audience === "1" : null,
  };
}

export type Coverage = "Sí" | "Parcial" | "No" | "Sin grupos";
export function coverage(total: number, withExclusion: number): Coverage {
  if (total === 0) return "Sin grupos";
  return withExclusion === total ? "Sí" : withExclusion === 0 ? "No" : "Parcial";
}

export interface AuditedAdSet extends MetaAdSetTargeting {
  universe: "CAPI WhatsApp" | "Compras Offline Web";
  excludesActiveCustomers: boolean;
  activeCustomerAudiences: MetaAudienceRef[];
  otherExcluded: MetaAudienceRef[];
  /** Activo pero con inicio programado a futuro. */
  scheduled: boolean;
}

export interface CampaignExclusion {
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  universe: AuditedAdSet["universe"];
  adSets: number;
  adSetsWithExclusion: number;
}

export interface AccountExclusion extends MetaAccountRead {
  campaigns: number;
  campaignsFull: number;
  campaignsPartial: number;
  campaignsNone: number;
  adSets: number;
  adSetsWithExclusion: number;
  /** Grupos con estado Activo descartados porque su fecha de fin (o la de su campaña) ya pasó. */
  endedSkipped: number;
}

export interface AudienceUse {
  id: string;
  name: string;
  activeCustomers: boolean;
  accounts: string[];
  adSets: number;
}

export interface ExclusionAudit {
  adSets: AuditedAdSet[];
  campaigns: CampaignExclusion[];
  accounts: AccountExclusion[];
  audiences: AudienceUse[];
}

export function auditExclusions(
  rows: MetaAdSetTargeting[],
  accounts: MetaAccountRead[],
  pattern: RegExp = audiencePattern(),
  now = Date.now(),
): ExclusionAudit {
  const matches = (a: MetaAudienceRef) => pattern.test(normalizeName(a.name));
  const running = rows.filter((r) => isRunning(r, now));
  const adSets: AuditedAdSet[] = running.map((row) => {
    const activeCustomerAudiences = row.excluded.filter(matches);
    const start = row.startTime ? Date.parse(row.startTime) : Number.NaN;
    return {
      ...row,
      universe: isCapiWhatsApp(row.campaignName) ? "CAPI WhatsApp" : "Compras Offline Web",
      excludesActiveCustomers: activeCustomerAudiences.length > 0,
      activeCustomerAudiences,
      otherExcluded: row.excluded.filter((a) => !matches(a)),
      scheduled: Number.isFinite(start) && start > now,
    };
  });
  adSets.sort(
    (a, b) =>
      a.accountName.localeCompare(b.accountName) ||
      a.campaignName.localeCompare(b.campaignName) ||
      a.adSetName.localeCompare(b.adSetName),
  );

  const campaigns = new Map<string, CampaignExclusion>();
  const audienceUse = new Map<string, AudienceUse>();
  for (const s of adSets) {
    const key = `${s.accountId}:${s.campaignId}`;
    const c = campaigns.get(key) ?? {
      accountId: s.accountId,
      accountName: s.accountName,
      campaignId: s.campaignId,
      campaignName: s.campaignName,
      universe: s.universe,
      adSets: 0,
      adSetsWithExclusion: 0,
    };
    c.adSets++;
    if (s.excludesActiveCustomers) c.adSetsWithExclusion++;
    campaigns.set(key, c);
    for (const a of s.excluded) {
      const u = audienceUse.get(a.id) ?? {
        id: a.id,
        name: a.name,
        activeCustomers: matches(a),
        accounts: [],
        adSets: 0,
      };
      if (!u.accounts.includes(s.accountId)) u.accounts.push(s.accountId);
      u.adSets++;
      audienceUse.set(a.id, u);
    }
  }

  const campaignList = [...campaigns.values()];
  const accountList: AccountExclusion[] = accounts.map((a) => {
    const own = adSets.filter((s) => s.accountId === a.accountId);
    const ownCampaigns = campaignList.filter((c) => c.accountId === a.accountId);
    const cov = ownCampaigns.map((c) => coverage(c.adSets, c.adSetsWithExclusion));
    return {
      ...a,
      campaigns: ownCampaigns.length,
      campaignsFull: cov.filter((c) => c === "Sí").length,
      campaignsPartial: cov.filter((c) => c === "Parcial").length,
      campaignsNone: cov.filter((c) => c === "No").length,
      adSets: own.length,
      adSetsWithExclusion: own.filter((s) => s.excludesActiveCustomers).length,
      endedSkipped: rows.filter((r) => r.accountId === a.accountId && r.adSetStatus === "ACTIVE" && !isRunning(r, now))
        .length,
    };
  });
  return {
    adSets,
    campaigns: campaignList,
    accounts: accountList,
    audiences: [...audienceUse.values()].sort(
      (a, b) => Number(b.activeCustomers) - Number(a.activeCustomers) || b.adSets - a.adSets,
    ),
  };
}

const yesNo = (value: boolean): Cell => ({ value: value ? "Sí" : "No", tone: value ? "good" : "bad" });
const coverageCell = (value: Coverage): Cell => ({
  value,
  tone: value === "Sí" ? "good" : value === "No" ? "bad" : value === "Parcial" ? "warn" : undefined,
});
const names = (list: MetaAudienceRef[]) => list.map((a) => a.name).join(" | ");
const share = (part: number, total: number) => (total ? part / total : null);
const day = (time: string) => (/^\d{4}-\d{2}-\d{2}/.test(time) ? time.slice(0, 10) : "");

export interface WorkbookMeta {
  generatedAt: string;
  pattern: string;
  apiVersion: string;
}

export function exclusionWorkbook(audit: ExclusionAudit, meta: WorkbookMeta): XlsxSheet[] {
  const failed = audit.accounts.filter((a) => a.error);
  const skipped = audit.accounts.reduce((n, a) => n + a.endedSkipped, 0);
  return [
    {
      name: "Resumen por cuenta",
      columns: [
        { header: "Cuenta ID", width: 20 },
        { header: "Cuenta", width: 34 },
        { header: "Estado de cuenta", width: 16 },
        { header: "Campañas activas", width: 12 },
        { header: "Campañas con exclusión en todos sus grupos", width: 20 },
        { header: "Campañas con exclusión parcial", width: 16 },
        { header: "Campañas sin exclusión", width: 14 },
        { header: "Grupos activos", width: 12 },
        { header: "Grupos que excluyen clientes activos", width: 18 },
        { header: "Grupos sin la exclusión", width: 14 },
        { header: "% grupos con exclusión", width: 14, pct: true },
        { header: "Lectura", width: 40 },
      ],
      rows: audit.accounts.map((a) => [
        a.accountId,
        a.accountName,
        accountStatusLabel(a.accountStatus),
        a.error ? null : a.campaigns,
        a.error ? null : a.campaignsFull,
        a.error ? null : a.campaignsPartial,
        a.error ? null : a.campaignsNone,
        a.error ? null : a.adSets,
        a.error ? null : a.adSetsWithExclusion,
        a.error ? null : a.adSets - a.adSetsWithExclusion,
        a.error ? null : share(a.adSetsWithExclusion, a.adSets),
        a.error
          ? { value: `Sin lectura: ${a.error}`, tone: "bad" }
          : a.campaigns === 0
            ? { value: "Sin campañas activas", tone: "warn" }
            : "Correcta",
      ]),
    },
    {
      name: "Campañas activas",
      columns: [
        { header: "Cuenta ID", width: 20 },
        { header: "Cuenta", width: 30 },
        { header: "Campaña ID", width: 22 },
        { header: "Campaña", width: 50 },
        { header: "Universo", width: 20 },
        { header: "Excluye clientes activos", width: 16 },
        { header: "Grupos activos", width: 12 },
        { header: "Con exclusión", width: 12 },
        { header: "Sin exclusión", width: 12 },
      ],
      rows: audit.campaigns.map((c) => [
        c.accountId,
        c.accountName,
        c.campaignId,
        c.campaignName,
        c.universe,
        coverageCell(coverage(c.adSets, c.adSetsWithExclusion)),
        c.adSets,
        c.adSetsWithExclusion,
        c.adSets - c.adSetsWithExclusion,
      ]),
    },
    {
      name: "Grupos activos",
      columns: [
        { header: "Cuenta ID", width: 20 },
        { header: "Cuenta", width: 30 },
        { header: "Campaña ID", width: 22 },
        { header: "Campaña", width: 46 },
        { header: "Universo", width: 20 },
        { header: "Grupo ID", width: 22 },
        { header: "Grupo de anuncios", width: 46 },
        { header: "Excluye clientes activos", width: 14 },
        { header: "Audiencia de clientes activos excluida", width: 40 },
        { header: "Otras audiencias excluidas", width: 40 },
        { header: "Audiencias incluidas", width: 40 },
        { header: "Audiencia Advantage+", width: 14 },
        { header: "Objetivo de optimización", width: 22 },
        { header: "Destino", width: 18 },
        { header: "Entrega", width: 12 },
        { header: "Inicio", width: 12 },
        { header: "Fin", width: 12 },
      ],
      rows: audit.adSets.map((s) => [
        s.accountId,
        s.accountName,
        s.campaignId,
        s.campaignName,
        s.universe,
        s.adSetId,
        s.adSetName,
        yesNo(s.excludesActiveCustomers),
        names(s.activeCustomerAudiences),
        names(s.otherExcluded),
        names(s.included),
        s.advantageAudience === null ? null : s.advantageAudience ? "Sí" : "No",
        s.optimizationGoal,
        s.destinationType,
        s.scheduled ? { value: "Programado", tone: "warn" } : "En curso",
        day(s.startTime),
        day(s.endTime) || day(s.campaignStopTime),
      ]),
    },
    {
      name: "Audiencias excluidas",
      columns: [
        { header: "Audiencia ID", width: 22 },
        { header: "Audiencia", width: 50 },
        { header: "Se cuenta como clientes activos", width: 18 },
        { header: "Grupos activos que la excluyen", width: 16 },
        { header: "Cuentas", width: 40 },
      ],
      rows: audit.audiences.map((a) => [a.id, a.name, yesNo(a.activeCustomers), a.adSets, a.accounts.join(", ")]),
    },
    {
      name: "Criterios",
      columns: [
        { header: "Concepto", width: 34 },
        { header: "Detalle", width: 110 },
      ],
      rows: [
        ["Generado", meta.generatedAt],
        ["Fuente", `Meta Marketing API ${meta.apiVersion}, segmentación de cada grupo de anuncios (solo lectura).`],
        [
          "Alcance",
          "Solo campañas activas: grupos de anuncios con estado efectivo Activo dentro de campañas activas. No se consideran campañas ni grupos pausados, archivados o eliminados, ni los que siguen marcados como activos pero ya pasaron su fecha de fin.",
        ],
        ["Activos descartados por fecha de fin", skipped],
        [
          "Clientes activos",
          `Un grupo excluye clientes activos si alguna de sus audiencias excluidas tiene un nombre que coincide con el patrón "${meta.pattern}" (sin acentos ni mayúsculas). Revisa la hoja Audiencias excluidas: si falta o sobra alguna, vuelve a generar con --patron.`,
        ],
        [
          "Universo",
          'Campañas con "CAPI WhatsApp" en el nombre se miden con On-Facebook Purchase; las demás con Compras Offline Web (Inbound). No se mezclan en el análisis.',
        ],
        [
          "Cobertura por campaña",
          "Sí: todos sus grupos activos excluyen clientes activos. Parcial: solo algunos. No: ninguno.",
        ],
        ["Entrega", "Programado: el grupo está activo pero su fecha de inicio todavía no llega."],
        [
          "Audiencia Advantage+",
          "Con audiencia Advantage+ las audiencias incluidas son sugerencias, pero las exclusiones siguen aplicando.",
        ],
        [
          "No cubre",
          "Exclusiones a nivel cuenta (controles de cuenta) ni listas de clientes existentes de campañas Advantage+ de ventas; esas se revisan en el Administrador de anuncios.",
        ],
        ...failed.map((a): Cell[] => [`Cuenta sin lectura ${a.accountId}`, a.error]),
      ],
    },
  ];
}
