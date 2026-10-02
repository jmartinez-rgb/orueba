import type { AdsProvider, ProviderRequestOptions } from "../providers/provider.js";
import type {
  NormalizedAccount,
  NormalizedBudget,
  NormalizedCampaign,
  NormalizedDeliverySignal,
  NormalizedPerformance,
  ProviderStatus,
} from "../types/normalized.js";
import { safeDiagnostic } from "../utils/diagnostics.js";
import { ApiError, type ErrorCode } from "../utils/errors.js";
import { withTimeout } from "../utils/timeout.js";
import type { XlsxSheet } from "../utils/xlsx.js";
import { z } from "zod";

export interface VerificationOperation {
  provider: string;
  account_id: string | null;
  section: string;
  date: string | null;
  state: "ok" | "empty" | "partial" | "error" | "not_configured" | "not_supported" | "skipped";
  codes: string[];
  /** Allowlisted stage/limitation/status fields only; never messages, bodies or URLs. */
  diagnostics?: string[];
  count: number;
}
export interface VerificationRead {
  extracted_at: string;
  operations: VerificationOperation[];
  statuses: ProviderStatus[];
  accounts: NormalizedAccount[];
  campaigns: NormalizedCampaign[];
  budgets: NormalizedBudget[];
  delivery: NormalizedDeliverySignal[];
  performance: NormalizedPerformance[];
}
export interface VerificationOptions {
  now?: Date;
  date?: string;
  maxAccounts?: number;
  maxRows?: number;
  timeoutMs?: number;
  accounts?: Readonly<Record<string, readonly string[]>>;
  signal?: AbortSignal;
  flushTokens?: () => Promise<void>;
}

/** Calendar yesterday in the source account's zone, including UTC offsets and DST. */
export function yesterdayInZone(now: Date, zone: string | null): string {
  if (!zone) throw new ApiError("INVALID_REQUEST", "La cuenta no informa una zona para determinar ayer.");
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return new Date(Date.UTC(part("year"), part("month") - 1, part("day")) - 86400000).toISOString().slice(0, 10);
  } catch {
    throw new ApiError("INVALID_REQUEST", "La zona de la cuenta no permite determinar ayer.");
  }
}
const code = (error: unknown): ErrorCode => (error instanceof ApiError ? error.code : "UNKNOWN");

/** Sequential, bounded first read. Raw metrics, credentials and original error bodies are never exported. */
export async function verifyProviders(
  providers: AdsProvider[],
  options: VerificationOptions = {},
): Promise<VerificationRead> {
  const now = options.now ?? new Date(),
    maxAccounts = options.maxAccounts ?? 25,
    maxRows = options.maxRows ?? 100000;
  if (
    !Number.isInteger(maxAccounts) ||
    maxAccounts < 1 ||
    maxAccounts > 1000 ||
    !Number.isInteger(maxRows) ||
    maxRows < 1
  )
    throw new ApiError("INVALID_REQUEST", "Los límites del verificador no son válidos.");
  if (options.date !== undefined && !z.iso.date().safeParse(options.date).success)
    throw new ApiError("INVALID_REQUEST", "Fecha del verificador inválida.");
  const out: VerificationRead = {
    extracted_at: now.toISOString(),
    operations: [],
    statuses: [],
    accounts: [],
    campaigns: [],
    budgets: [],
    delivery: [],
    performance: [],
  };
  const append = <T>(target: T[], value: T[] | undefined) => {
    if (!value) return;
    if (target.length + value.length > maxRows) {
      const operation = out.operations.at(-1)!;
      operation.state = "error";
      operation.codes.push("ROW_LIMIT");
      operation.count = 0;
      return;
    }
    target.push(...value);
  };
  for (const provider of providers) {
    const timeout = options.timeoutMs ?? provider.timeoutMs ?? 60000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000)
      throw new ApiError("INVALID_REQUEST", "Plazo inválido.");
    const read = async <T>(
      accountId: string | null,
      section: string,
      date: string | null,
      work: (request: ProviderRequestOptions) => Promise<T>,
    ): Promise<T | undefined> => {
      const warnings: string[] = [],
        diagnostics: string[] = [];
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout);
      try {
        signal.throwIfAborted();
        const value = await withTimeout(
          work({
            signal,
            onWarning: (e) => {
              warnings.push(e.code);
              const diagnostic = safeDiagnostic(e);
              if (diagnostic) diagnostics.push(diagnostic);
            },
          }),
          timeout,
          provider.name,
        );
        await options.flushTokens?.();
        if (
          Array.isArray(value) &&
          value.some(
            (row) =>
              !row ||
              typeof row !== "object" ||
              row.platform !== provider.slug ||
              (accountId !== null && row.account_id !== accountId) ||
              (section === "performance" && (row.date !== date || row.hour !== null)),
          )
        )
          throw new ApiError("PROVIDER_ERROR", "El proveedor devolvió datos de otro ámbito.");
        const count = Array.isArray(value) ? value.length : 1;
        if (count > maxRows) throw new ApiError("PROVIDER_ERROR", "El reporte excedió el límite de filas.");
        out.operations.push({
          provider: provider.slug,
          account_id: accountId,
          section,
          date,
          count,
          state: warnings.length ? "partial" : count ? "ok" : "empty",
          codes: [...new Set(warnings)],
          ...(diagnostics.length ? { diagnostics: [...new Set(diagnostics)] } : {}),
        });
        return value;
      } catch (error) {
        const failure = safeDiagnostic(error);
        if (failure) diagnostics.push(failure);
        out.operations.push({
          provider: provider.slug,
          account_id: accountId,
          section,
          date,
          count: 0,
          state: "error",
          codes: [...new Set([...warnings, signal.aborted ? "PROVIDER_TIMEOUT" : code(error)])],
          ...(diagnostics.length ? { diagnostics: [...new Set(diagnostics)] } : {}),
        });
        return undefined;
      }
    };
    if (!provider.implemented || !provider.isConfigured()) {
      out.operations.push({
        provider: provider.slug,
        account_id: null,
        section: "configuration",
        date: null,
        state: "not_configured",
        codes: ["NOT_CONFIGURED"],
        count: 0,
      });
      continue;
    }
    const status = await read(null, "status", null, () => provider.status());
    if (!status) continue;
    out.statuses.push(status);
    if (!["connected", "degraded"].includes(status.state)) {
      out.operations.push({
        provider: provider.slug,
        account_id: null,
        section: "access",
        date: null,
        state: "error",
        codes: [status.last_error?.code ?? "ACCESS_DENIED"],
        count: 0,
      });
      continue;
    }
    const accounts = await read(null, "accounts", null, (request) => provider.listAccounts({}, request));
    if (!accounts) continue;
    append(out.accounts, accounts);
    const requested = options.accounts?.[provider.slug];
    if (requested?.some((id) => !accounts.some((a) => a.account_id === id))) {
      out.operations.push({
        provider: provider.slug,
        account_id: null,
        section: "selection",
        date: null,
        state: "error",
        codes: ["ACCOUNT_NOT_FOUND"],
        count: 0,
      });
      continue;
    }
    const eligible = accounts.filter((a) => !a.is_manager && (!requested || requested.includes(a.account_id)));
    for (const account of eligible.slice(maxAccounts))
      out.operations.push({
        provider: provider.slug,
        account_id: account.account_id,
        section: "coverage",
        date: null,
        state: "skipped",
        codes: ["ACCOUNT_LIMIT"],
        count: 0,
      });
    for (const account of eligible.slice(0, maxAccounts)) {
      const query = { account_id: account.account_id };
      const campaigns = await read(account.account_id, "campaigns", null, (request) =>
        provider.listCampaigns(query, request),
      );
      append(out.campaigns, campaigns);
      if (provider.listBudgets) {
        const rows = await read(account.account_id, "budgets", null, (request) =>
          provider.listBudgets!(query, request),
        );
        append(out.budgets, rows);
      } else
        out.operations.push({
          provider: provider.slug,
          account_id: account.account_id,
          section: "budgets",
          date: null,
          state: "not_supported",
          codes: [],
          count: 0,
        });
      if (provider.listDeliverySignals) {
        const rows = await read(account.account_id, "delivery", null, (request) =>
          provider.listDeliverySignals!(query, request),
        );
        append(out.delivery, rows);
      } else
        out.operations.push({
          provider: provider.slug,
          account_id: account.account_id,
          section: "delivery",
          date: null,
          state: "not_supported",
          codes: [],
          count: 0,
        });
      let date: string;
      try {
        // These providers document UTC report days, independently of their account metadata timezone.
        const zone = ["spotify", "microsoft"].includes(provider.slug) ? "UTC" : account.timezone;
        date = options.date ?? yesterdayInZone(now, zone);
      } catch (error) {
        out.operations.push({
          provider: provider.slug,
          account_id: account.account_id,
          section: "performance",
          date: null,
          state: "error",
          codes: [code(error)],
          count: 0,
        });
        continue;
      }
      const rows = await read(account.account_id, "performance", date, (request) =>
        provider.getPerformance({ ...query, date_from: date, date_to: date, granularity: "daily" }, request),
      );
      append(out.performance, rows);
    }
  }
  await options.flushTokens?.();
  return out;
}

export function verificationSheets(read: VerificationRead): XlsxSheet[] {
  const action = (row: NormalizedPerformance) => {
    const value = row.raw_metrics.primary_conversion_action ?? row.raw_metrics.primary_conversion_metric;
    return typeof value === "string" && /^[\w.:-]{1,200}$/.test(value) ? value : null;
  };
  const scope = (row: NormalizedPerformance) => {
    const value = row.raw_metrics.primary_conversion_scope;
    return typeof value === "string" && ["campaign_rule", "unmatched_rule", "account", "global", "none"].includes(value)
      ? value
      : null;
  };
  const sheet = (name: string, headers: string[], rows: XlsxSheet["rows"]): XlsxSheet => ({
    name,
    columns: headers.map((header) => ({ header, width: 24 })),
    rows,
  });
  return [
    sheet(
      "Cobertura",
      ["Plataforma", "Cuenta ID", "Sección", "Fecha", "Estado", "Códigos", "Diagnóstico", "Filas", "Extraído"],
      read.operations.map((r) => [
        r.provider,
        r.account_id,
        r.section,
        r.date,
        r.state,
        r.codes.join(", "),
        r.diagnostics?.join(" | ") ?? "",
        r.count,
        read.extracted_at,
      ]),
    ),
    sheet(
      "Conexiones",
      ["Plataforma", "Estado", "Configurada", "Implementada", "Variables faltantes", "Código", "Comprobado"],
      read.statuses.map((r) => [
        r.provider,
        r.state,
        r.configured ? "Sí" : "No",
        r.implemented ? "Sí" : "No",
        r.missing_config.join(", "),
        r.last_error?.code,
        r.checked_at,
      ]),
    ),
    sheet(
      "Cuentas",
      ["Plataforma", "Cliente", "Cuenta ID", "Cuenta", "Moneda", "Zona", "Estado", "MCC"],
      read.accounts.map((r) => [
        r.platform,
        r.client_id,
        r.account_id,
        r.account_name,
        r.currency,
        r.timezone,
        r.status,
        r.is_manager ? "Sí" : "No",
      ]),
    ),
    sheet(
      "Campañas",
      ["Plataforma", "Cuenta ID", "Campaña ID", "Campaña", "Estado", "Estado original", "Objetivo"],
      read.campaigns.map((r) => [
        r.platform,
        r.account_id,
        r.campaign_id,
        r.campaign_name,
        r.campaign_status,
        r.source_status,
        r.objective,
      ]),
    ),
    sheet(
      "Presupuestos actuales",
      [
        "Plataforma",
        "Cuenta ID",
        "Moneda",
        "Campaña ID",
        "Campaña",
        "Nivel",
        "Conjunto ID",
        "Conjunto",
        "Tipo",
        "Diario",
        "Total",
        "Restante",
        "Diario estimado",
        "Compartido ID",
        "Limitada",
        "Diario recomendado",
        "Inicio",
        "Fin",
        "Extraído",
      ],
      read.budgets.map((r) => [
        r.platform,
        r.account_id,
        r.currency,
        r.campaign_id,
        r.campaign_name,
        r.budget_level,
        r.ad_set_id,
        r.ad_set_name,
        r.budget_type,
        r.daily_budget,
        r.lifetime_budget,
        r.budget_remaining,
        r.daily_estimate,
        r.shared_budget_id,
        r.limited_by_budget === null ? null : r.limited_by_budget ? "Sí" : "No",
        r.recommended_daily_budget,
        r.start_time,
        r.end_time,
        r.extracted_at,
      ]),
    ),
    sheet(
      "Salud de entrega actual",
      [
        "Plataforma",
        "Cuenta ID",
        "Nivel",
        "Campaña ID",
        "Entidad ID",
        "Entidad",
        "Tipo",
        "Severidad",
        "Código",
        "Moneda",
        "Tope",
        "Gastado contra tope",
        "Extraído",
      ],
      read.delivery.map((r) => [
        r.platform,
        r.account_id,
        r.entity_level,
        r.campaign_id,
        r.entity_id,
        r.entity_name,
        r.kind,
        r.severity,
        r.code,
        r.currency,
        r.spend_cap,
        r.amount_spent,
        r.extracted_at,
      ]),
    ),
    sheet(
      "Rendimiento diario",
      [
        "Plataforma",
        "Cuenta ID",
        "Cuenta",
        "Campaña ID",
        "Campaña",
        "Fecha",
        "Zona",
        "Moneda",
        "Costo",
        "Impresiones",
        "Clics",
        "Conversiones",
        "Valor",
        "CPA",
        "CTR",
        "CPC",
        "CPM",
        "Acción o métrica principal",
        "Selección principal",
        "Observación de valor",
        "Extraído",
      ],
      read.performance.map((r) => [
        r.platform,
        r.account_id,
        r.account_name,
        r.campaign_id,
        r.campaign_name,
        r.date,
        r.source_timezone,
        r.currency,
        r.spend,
        r.impressions,
        r.clicks,
        r.conversions,
        r.conversion_value,
        r.cpa,
        r.ctr,
        r.cpc,
        r.cpm,
        action(r),
        scope(r),
        r.platform === "tiktok" && action(r) === "complete_payment" ? "TIKTOK_PURCHASE_VALUE_UNVERIFIED" : null,
        r.extracted_at,
      ]),
    ),
    sheet(
      "Notas",
      ["Tema", "Criterio"],
      [
        [
          "Fecha",
          "Ayer según zona de cada cuenta, salvo --fecha explícita. Presupuestos y salud son actuales, no históricos.",
        ],
        [
          "Ausencias",
          "Celdas vacías son datos ausentes. empty significa sin filas, no gasto cero. Consulte Cobertura.",
        ],
        [
          "Comparación",
          "Misma cuenta, moneda, zona y atribución en Ads Manager; este archivo no constituye conciliación.",
        ],
        [
          "Acciones",
          "Meta conserva reglas configuradas; los dos grupos de izzi no se mezclan. No se eligen eventos principales.",
        ],
        [
          "Valor de TikTok",
          "El valor de complete_payment sigue sin unidades confirmadas; no tratarlo como ingreso. Se conserva como dato informado con una observación.",
        ],
        [
          "Totales",
          "No se suman monedas, eventos superpuestos ni presupuestos compartidos. CPA = suma de costo / suma de conversiones.",
        ],
        [
          "Credenciales",
          "Se exportan columnas permitidas: no raw_metrics, cuerpos de errores, cabeceras ni configuración privada.",
        ],
      ],
    ),
  ];
}
