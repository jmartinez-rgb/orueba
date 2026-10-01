import type { Cell, XlsxSheet } from "../../utils/xlsx.js";
import { metaObject } from "./types.js";
import { isCapiWhatsApp } from "./exclusions.js";

/**
 * Apoyo para decidir la acción principal de Meta por cuenta: qué acciones reporta cada cuenta en un
 * periodo, con su volumen, separadas por universo (campañas «CAPI WhatsApp» y el resto). No elige
 * nada: marca las que coinciden por nombre con la regla de medición vigente para que el equipo las
 * confirme y las configure.
 */

export const ACTIONS_INSIGHT_FIELDS = "campaign_id,campaign_name,spend,actions,action_values";
export const CUSTOM_CONVERSION_FIELDS = "id,name,custom_event_type,event_source_type,is_archived";

export type Universe = "CAPI WhatsApp" | "Compras Offline Web";

export interface ActionRow {
  accountId: string;
  accountName: string;
  universe: Universe;
  actionType: string;
  label: string;
  conversions: number;
  value: number;
  campaigns: number;
  campaignSpend: number;
  universeSpend: number;
  /** Coincide por nombre con la regla de medición del universo; requiere confirmación. */
  matchesRule: boolean;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};
const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Nombre legible: conversión personalizada por su ID o el tipo tal cual. */
export function actionLabel(type: string, customNames: Map<string, string>): string {
  const custom = /\.custom\.(\d+)$/.exec(type);
  return custom && customNames.has(custom[1]!) ? `${customNames.get(custom[1]!)} (personalizada)` : type;
}

/** Regla vigente de izzi, solo como pista por nombre: CAPI WhatsApp → On-Facebook Purchase; resto → Compras Offline Web (Inbound). */
export function matchesRule(universe: Universe, type: string, label: string): boolean {
  const t = fold(`${type} ${label}`);
  return universe === "CAPI WhatsApp"
    ? /onsite_conversion\.purchase|onsite_web_purchase|on-?facebook purchase/.test(t)
    : /compras? offline web|offline web.*inbound|inbound.*offline/.test(t);
}

export function aggregateActions(
  account: { id: string; name: string },
  insights: Record<string, unknown>[],
  customNames: Map<string, string>,
): ActionRow[] {
  const universeSpend: Record<Universe, number> = { "CAPI WhatsApp": 0, "Compras Offline Web": 0 };
  const rows = new Map<string, ActionRow & { campaignIds: Set<string> }>();
  for (const r of insights.filter(metaObject)) {
    const name = typeof r.campaign_name === "string" ? r.campaign_name : "";
    const universe: Universe = isCapiWhatsApp(name) ? "CAPI WhatsApp" : "Compras Offline Web";
    const spend = num(r.spend);
    universeSpend[universe] += spend;
    const values = new Map<string, number>();
    if (Array.isArray(r.action_values))
      for (const a of r.action_values.filter(metaObject))
        if (typeof a.action_type === "string") values.set(a.action_type, num(a.value));
    if (!Array.isArray(r.actions)) continue;
    for (const a of r.actions.filter(metaObject)) {
      if (typeof a.action_type !== "string") continue;
      const key = `${universe}|${a.action_type}`;
      const label = actionLabel(a.action_type, customNames);
      const row = rows.get(key) ?? {
        accountId: account.id,
        accountName: account.name,
        universe,
        actionType: a.action_type,
        label,
        conversions: 0,
        value: 0,
        campaigns: 0,
        campaignSpend: 0,
        universeSpend: 0,
        matchesRule: matchesRule(universe, a.action_type, label),
        campaignIds: new Set<string>(),
      };
      row.conversions += num(a.value);
      row.value += values.get(a.action_type) ?? 0;
      const id = typeof r.campaign_id === "string" ? r.campaign_id : name;
      if (!row.campaignIds.has(id)) {
        row.campaignIds.add(id);
        row.campaignSpend += spend;
      }
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .map(({ campaignIds, ...row }) => ({
      ...row,
      campaigns: campaignIds.size,
      universeSpend: universeSpend[row.universe],
    }))
    .sort(
      (a, b) =>
        a.universe.localeCompare(b.universe) ||
        Number(b.matchesRule) - Number(a.matchesRule) ||
        b.conversions - a.conversions,
    );
}

const round = (v: number) => Math.round(v * 100) / 100;

export function actionsWorkbook(
  rows: ActionRow[],
  accounts: Array<{ id: string; name: string; error: string | null }>,
  meta: { since: string; until: string; generatedAt: string },
): XlsxSheet[] {
  const candidates = rows.filter((r) => r.matchesRule);
  const capi = [...new Set(candidates.filter((r) => r.universe === "CAPI WhatsApp").map((r) => r.actionType))];
  const rest = [...new Set(candidates.filter((r) => r.universe === "Compras Offline Web").map((r) => r.actionType))];
  return [
    {
      name: "Acciones por cuenta",
      columns: [
        { header: "Cuenta ID", width: 20 },
        { header: "Cuenta", width: 30 },
        { header: "Universo", width: 20 },
        { header: "Acción (action_type)", width: 46 },
        { header: "Nombre", width: 44 },
        { header: "Coincide con la regla", width: 14 },
        { header: "Conversiones", width: 13 },
        { header: "Valor", width: 13 },
        { header: "Campañas con la acción", width: 14 },
        { header: "% del gasto del universo", width: 14, pct: true },
      ],
      rows: rows.map((r): Cell[] => [
        r.accountId,
        r.accountName,
        r.universe,
        r.actionType,
        r.label,
        r.matchesRule ? { value: "Revisar", tone: "good" } : null,
        round(r.conversions),
        round(r.value),
        r.campaigns,
        r.universeSpend > 0 ? r.campaignSpend / r.universeSpend : null,
      ]),
    },
    {
      name: "Configuración por confirmar",
      columns: [
        { header: "Concepto", width: 34 },
        { header: "Valor", width: 110 },
      ],
      rows: [
        ["Periodo", `${meta.since} a ${meta.until}`],
        [
          "Cómo se usa",
          "Confirma en el Administrador de anuncios cuál acción corresponde a cada universo y copia las líneas a la configuración privada (.env). Nada se aplica solo.",
        ],
        [
          "META_PRIMARY_CONVERSION_RULES",
          capi.length === 1
            ? `[{"campaign_contains":"CAPI WhatsApp","action":"${capi[0]}"}]`
            : capi.length
              ? `Varias candidatas para CAPI WhatsApp: ${capi.join(", ")}. Elige una.`
              : "Sin candidata por nombre para CAPI WhatsApp: elige la acción de On-Facebook Purchase en la hoja anterior.",
        ],
        [
          "META_PRIMARY_CONVERSION_ACTION",
          rest.length === 1
            ? rest[0]!
            : rest.length
              ? `Varias candidatas para Compras Offline Web: ${rest.join(", ")}. Elige una.`
              : "Sin candidata por nombre para Compras Offline Web (Inbound): elige la conversión en la hoja anterior.",
        ],
        ["Generado", meta.generatedAt],
        ...accounts.filter((a) => a.error).map((a): Cell[] => [`Cuenta sin lectura ${a.id}`, a.error]),
      ],
    },
  ];
}
