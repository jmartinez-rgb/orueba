import type { Cell, XlsxSheet } from "../../utils/xlsx.js";
import { metaObject } from "./types.js";

/**
 * Revisión de públicos excluidos en grupos de anuncios de Meta: qué cuentas, campañas y grupos
 * excluyen la audiencia de clientes activos y cuáles no. Solo usa el ID y el nombre de cada
 * audiencia tal como aparecen en la segmentación; nunca consulta datos de personas.
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
  adSetId: string;
  adSetName: string;
  adSetStatus: string;
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
  error: string | null;
}

/** Nombres de audiencia que cuentan como clientes activos, comparados sin acentos ni mayúsculas. */
export const DEFAULT_ACTIVE_CUSTOMER_PATTERN = "client.*activ|activ.*client";

export const ADSET_FIELDS = [
  "id",
  "name",
  "effective_status",
  "optimization_goal",
  "destination_type",
  "campaign{id,name,effective_status}",
  "targeting{custom_audiences,excluded_custom_audiences,targeting_automation}",
].join(",");
/** Respaldo si Meta no acepta subcampos de targeting: pide la segmentación completa en páginas chicas. */
export const ADSET_FIELDS_FULL_TARGETING = ADSET_FIELDS.replace(/targeting\{[^}]*\}/, "targeting");

export const ADSET_STATUSES = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "IN_PROCESS", "WITH_ISSUES"];

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
    adSetId: text(raw.id),
    adSetName: text(raw.name),
    adSetStatus: text(raw.effective_status),
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
}

export interface CampaignExclusion {
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  universe: AuditedAdSet["universe"];
  adSets: number;
  adSetsWithExclusion: number;
  activeAdSets: number;
  activeWithExclusion: number;
}

export interface AccountExclusion extends MetaAccountRead {
  adSets: number;
  adSetsWithExclusion: number;
  activeAdSets: number;
  activeWithExclusion: number;
  campaigns: number;
}

export interface AudienceUse {
  id: string;
  name: string;
  activeCustomers: boolean;
  accounts: string[];
  adSets: number;
  activeAdSets: number;
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
): ExclusionAudit {
  const matches = (a: MetaAudienceRef) => pattern.test(normalizeName(a.name));
  const adSets: AuditedAdSet[] = rows.map((row) => {
    const activeCustomerAudiences = row.excluded.filter(matches);
    return {
      ...row,
      universe: isCapiWhatsApp(row.campaignName) ? "CAPI WhatsApp" : "Compras Offline Web",
      excludesActiveCustomers: activeCustomerAudiences.length > 0,
      activeCustomerAudiences,
      otherExcluded: row.excluded.filter((a) => !matches(a)),
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
    const active = s.adSetStatus === "ACTIVE";
    const key = `${s.accountId}:${s.campaignId}`;
    const c = campaigns.get(key) ?? {
      accountId: s.accountId,
      accountName: s.accountName,
      campaignId: s.campaignId,
      campaignName: s.campaignName,
      campaignStatus: s.campaignStatus,
      universe: s.universe,
      adSets: 0,
      adSetsWithExclusion: 0,
      activeAdSets: 0,
      activeWithExclusion: 0,
    };
    c.adSets++;
    if (s.excludesActiveCustomers) c.adSetsWithExclusion++;
    if (active) c.activeAdSets++;
    if (active && s.excludesActiveCustomers) c.activeWithExclusion++;
    campaigns.set(key, c);
    for (const a of s.excluded) {
      const u = audienceUse.get(a.id) ?? {
        id: a.id,
        name: a.name,
        activeCustomers: matches(a),
        accounts: [],
        adSets: 0,
        activeAdSets: 0,
      };
      if (!u.accounts.includes(s.accountId)) u.accounts.push(s.accountId);
      u.adSets++;
      if (active) u.activeAdSets++;
      audienceUse.set(a.id, u);
    }
  }

  const campaignList = [...campaigns.values()];
  const accountList: AccountExclusion[] = accounts.map((a) => {
    const own = adSets.filter((s) => s.accountId === a.accountId);
    return {
      ...a,
      adSets: own.length,
      adSetsWithExclusion: own.filter((s) => s.excludesActiveCustomers).length,
      activeAdSets: own.filter((s) => s.adSetStatus === "ACTIVE").length,
      activeWithExclusion: own.filter((s) => s.adSetStatus === "ACTIVE" && s.excludesActiveCustomers).length,
      campaigns: campaignList.filter((c) => c.accountId === a.accountId).length,
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

export interface WorkbookMeta {
  generatedAt: string;
  pattern: string;
  statuses: string[];
  apiVersion: string;
}

export function exclusionWorkbook(audit: ExclusionAudit, meta: WorkbookMeta): XlsxSheet[] {
  const failed = audit.accounts.filter((a) => a.error);
  return [
    {
      name: "Resumen por cuenta",
      columns: [
        { header: "Cuenta ID", width: 20 },
        { header: "Cuenta", width: 34 },
        { header: "Campañas", width: 11 },
        { header: "Grupos activos", width: 15 },
        { header: "Activos que excluyen clientes activos", width: 22 },
        { header: "Activos sin la exclusión", width: 16 },
        { header: "% activos con exclusión", width: 16, pct: true },
        { header: "Grupos revisados (todos los estados)", width: 20 },
        { header: "Revisados con exclusión", width: 16 },
        { header: "Lectura", width: 40 },
      ],
      rows: audit.accounts.map((a) => [
        a.accountId,
        a.accountName,
        a.error ? null : a.campaigns,
        a.error ? null : a.activeAdSets,
        a.error ? null : a.activeWithExclusion,
        a.error ? null : a.activeAdSets - a.activeWithExclusion,
        a.error ? null : share(a.activeWithExclusion, a.activeAdSets),
        a.error ? null : a.adSets,
        a.error ? null : a.adSetsWithExclusion,
        a.error ? { value: `Sin lectura: ${a.error}`, tone: "bad" } : "Correcta",
      ]),
    },
    {
      name: "Campañas",
      columns: [
        { header: "Cuenta ID", width: 20 },
        { header: "Cuenta", width: 30 },
        { header: "Campaña ID", width: 22 },
        { header: "Campaña", width: 50 },
        { header: "Universo", width: 20 },
        { header: "Estado campaña", width: 16 },
        { header: "Excluye clientes activos (grupos activos)", width: 22 },
        { header: "Grupos activos", width: 12 },
        { header: "Activos con exclusión", width: 14 },
        { header: "Excluye clientes activos (todos los grupos)", width: 22 },
        { header: "Grupos revisados", width: 12 },
        { header: "Revisados con exclusión", width: 14 },
      ],
      rows: audit.campaigns.map((c) => [
        c.accountId,
        c.accountName,
        c.campaignId,
        c.campaignName,
        c.universe,
        statusLabel(c.campaignStatus),
        coverageCell(coverage(c.activeAdSets, c.activeWithExclusion)),
        c.activeAdSets,
        c.activeWithExclusion,
        coverageCell(coverage(c.adSets, c.adSetsWithExclusion)),
        c.adSets,
        c.adSetsWithExclusion,
      ]),
    },
    {
      name: "Grupos de anuncios",
      columns: [
        { header: "Cuenta ID", width: 20 },
        { header: "Cuenta", width: 30 },
        { header: "Campaña ID", width: 22 },
        { header: "Campaña", width: 46 },
        { header: "Universo", width: 20 },
        { header: "Estado campaña", width: 16 },
        { header: "Grupo ID", width: 22 },
        { header: "Grupo de anuncios", width: 46 },
        { header: "Estado grupo", width: 16 },
        { header: "Excluye clientes activos", width: 14 },
        { header: "Audiencia de clientes activos excluida", width: 40 },
        { header: "Otras audiencias excluidas", width: 40 },
        { header: "Audiencias incluidas", width: 40 },
        { header: "Audiencia Advantage+", width: 14 },
        { header: "Objetivo de optimización", width: 22 },
        { header: "Destino", width: 18 },
      ],
      rows: audit.adSets.map((s) => [
        s.accountId,
        s.accountName,
        s.campaignId,
        s.campaignName,
        s.universe,
        statusLabel(s.campaignStatus),
        s.adSetId,
        s.adSetName,
        statusLabel(s.adSetStatus),
        yesNo(s.excludesActiveCustomers),
        names(s.activeCustomerAudiences),
        names(s.otherExcluded),
        names(s.included),
        s.advantageAudience === null ? null : s.advantageAudience ? "Sí" : "No",
        s.optimizationGoal,
        s.destinationType,
      ]),
    },
    {
      name: "Audiencias excluidas",
      columns: [
        { header: "Audiencia ID", width: 22 },
        { header: "Audiencia", width: 50 },
        { header: "Se cuenta como clientes activos", width: 18 },
        { header: "Grupos que la excluyen", width: 14 },
        { header: "Grupos activos que la excluyen", width: 16 },
        { header: "Cuentas", width: 40 },
      ],
      rows: audit.audiences.map((a) => [
        a.id,
        a.name,
        yesNo(a.activeCustomers),
        a.adSets,
        a.activeAdSets,
        a.accounts.join(", "),
      ]),
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
          "Clientes activos",
          `Un grupo excluye clientes activos si alguna de sus audiencias excluidas tiene un nombre que coincide con el patrón "${meta.pattern}" (sin acentos ni mayúsculas). Revisa la hoja Audiencias excluidas: si falta o sobra alguna, vuelve a generar con --patron.`,
        ],
        ["Estados revisados", meta.statuses.map(statusLabel).join(", ")],
        ["Grupos activos", "Estado efectivo Activo: el grupo y su campaña están encendidos."],
        [
          "Universo",
          'Campañas con "CAPI WhatsApp" en el nombre se miden con On-Facebook Purchase; las demás con Compras Offline Web (Inbound). No se mezclan en el análisis.',
        ],
        [
          "Cobertura por campaña",
          "Sí: todos sus grupos excluyen clientes activos. Parcial: solo algunos. No: ninguno. Sin grupos: no tiene grupos en ese estado.",
        ],
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
