import type { AdsProvider } from "../providers/provider.js";
import type { NormalizedBudget, NormalizedDeliverySignal, NormalizedPerformance } from "../types/normalized.js";
import type { Cell, XlsxSheet } from "../utils/xlsx.js";
import { ApiError } from "../utils/errors.js";

/**
 * Primera lectura real por plataforma: estado, cuentas, campañas, presupuestos, salud de entrega y
 * rendimiento de un día. Solo lectura. Guarda conteos, códigos de error y totales agregados para
 * conciliar contra cada interfaz; nunca tokens, cabeceras ni respuestas crudas.
 */

export type CheckName = "estado" | "cuentas" | "campañas" | "presupuestos" | "salud" | "rendimiento";
export interface CheckRow {
  platform: string;
  check: CheckName;
  result: "OK" | "ERROR" | "OMITIDO";
  count: number | null;
  ms: number;
  code: string | null;
  message: string | null;
}
export interface Warning {
  platform: string;
  check: CheckName;
  code: string;
  message: string;
}
export interface VerificationResult {
  date: string;
  checks: CheckRow[];
  budgets: NormalizedBudget[];
  signals: NormalizedDeliverySignal[];
  performance: NormalizedPerformance[];
  warnings: Warning[];
}

const safe = (e: unknown) =>
  e instanceof ApiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: "Error inesperado." };

export async function runChecks(
  providers: AdsProvider[],
  date: string,
  onProgress: (row: CheckRow) => void = () => undefined,
): Promise<VerificationResult> {
  const result: VerificationResult = { date, checks: [], budgets: [], signals: [], performance: [], warnings: [] };
  for (const p of providers) {
    const record = (row: CheckRow) => {
      result.checks.push(row);
      onProgress(row);
    };
    const skip = (check: CheckName, message: string) =>
      record({ platform: p.slug, check, result: "OMITIDO", count: null, ms: 0, code: null, message });
    if (!p.implemented || !p.isConfigured()) {
      skip("estado", p.implemented ? "Sin configurar en .env." : "Integración pendiente.");
      continue;
    }
    const run = async <T>(
      check: CheckName,
      work: (signal: AbortSignal, onWarning: (e: ApiError) => void) => Promise<T[]>,
    ) => {
      const start = Date.now();
      try {
        // Margen sobre el límite propio del proveedor, que corta primero con su propio error.
        const signal = AbortSignal.timeout(Math.max(p.timeoutMs ?? 15000, 15000) + 5000);
        const rows = await work(signal, (w) =>
          result.warnings.push({ platform: p.slug, check, code: w.code, message: w.message }),
        );
        record({
          platform: p.slug,
          check,
          result: "OK",
          count: rows.length,
          ms: Date.now() - start,
          code: null,
          message: null,
        });
        return rows;
      } catch (e) {
        const { code, message } = safe(e);
        record({ platform: p.slug, check, result: "ERROR", count: null, ms: Date.now() - start, code, message });
        return null;
      }
    };
    const start = Date.now();
    const status = await p.status();
    record({
      platform: p.slug,
      check: "estado",
      result: status.state === "connected" ? "OK" : "ERROR",
      count: null,
      ms: Date.now() - start,
      code: status.state,
      message: status.last_error?.message ?? null,
    });
    if (status.state !== "connected" && status.state !== "degraded") continue;
    await run("cuentas", (signal, onWarning) => p.listAccounts({}, { signal, onWarning }));
    await run("campañas", (signal, onWarning) => p.listCampaigns({}, { signal, onWarning }));
    if (p.listBudgets) {
      const rows = await run("presupuestos", (signal, onWarning) => p.listBudgets!({}, { signal, onWarning }));
      if (rows) result.budgets.push(...rows);
    } else skip("presupuestos", "La plataforma aún no la ofrece.");
    if (p.listDeliverySignals) {
      const rows = await run("salud", (signal, onWarning) => p.listDeliverySignals!({}, { signal, onWarning }));
      if (rows) result.signals.push(...rows);
    } else skip("salud", "La plataforma aún no la ofrece.");
    const perf = await run("rendimiento", (signal, onWarning) =>
      p.getPerformance({ date_from: date, date_to: date, granularity: "daily" }, { signal, onWarning }),
    );
    if (perf) result.performance.push(...perf);
  }
  return result;
}

interface AccountDay {
  platform: string;
  account: string;
  name: string;
  currency: string;
  rows: number;
  campaigns: Set<string>;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  nullConversions: number;
}

/** Totales de un día por cuenta y moneda, para comparar con cada interfaz. Nunca se suman monedas. */
export function performanceByAccount(rows: NormalizedPerformance[]): AccountDay[] {
  const map = new Map<string, AccountDay>();
  for (const r of rows) {
    const key = `${r.platform}|${r.account_id}|${r.currency ?? "?"}`;
    const a = map.get(key) ?? {
      platform: r.platform,
      account: r.account_id,
      name: r.account_name ?? r.account_id,
      currency: r.currency ?? "?",
      rows: 0,
      campaigns: new Set<string>(),
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      nullConversions: 0,
    };
    a.rows++;
    if (r.campaign_id) a.campaigns.add(r.campaign_id);
    a.spend += r.spend ?? 0;
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    if (r.conversions === null) a.nullConversions++;
    else a.conversions += r.conversions;
    map.set(key, a);
  }
  return [...map.values()].sort((a, b) => a.platform.localeCompare(b.platform) || b.spend - a.spend);
}

const tone = (result: CheckRow["result"]): Cell => ({
  value: result,
  tone: result === "OK" ? "good" : result === "ERROR" ? "bad" : "warn",
});
const round = (v: number) => Math.round(v * 100) / 100;

export function verificationWorkbook(r: VerificationResult, generatedAt: string): XlsxSheet[] {
  const accounts = performanceByAccount(r.performance);
  return [
    {
      name: "Resumen",
      columns: [
        { header: "Plataforma", width: 12 },
        { header: "Consulta", width: 14 },
        { header: "Resultado", width: 11 },
        { header: "Filas", width: 9 },
        { header: "Duración (ms)", width: 13 },
        { header: "Código", width: 22 },
        { header: "Mensaje", width: 70 },
      ],
      rows: r.checks.map((c) => [c.platform, c.check, tone(c.result), c.count, c.ms, c.code, c.message]),
    },
    {
      name: "Rendimiento por cuenta",
      columns: [
        { header: "Plataforma", width: 12 },
        { header: "Cuenta ID", width: 22 },
        { header: "Cuenta", width: 34 },
        { header: "Moneda", width: 8 },
        { header: "Campañas con filas", width: 14 },
        { header: "Gasto", width: 14 },
        { header: "Impresiones", width: 14 },
        { header: "Clics", width: 12 },
        { header: "Conversiones (acción principal)", width: 18 },
        { header: "Filas sin acción principal", width: 16 },
      ],
      rows: accounts.map((a) => [
        a.platform,
        a.account,
        a.name,
        a.currency,
        a.campaigns.size,
        round(a.spend),
        a.impressions,
        a.clicks,
        round(a.conversions),
        a.nullConversions,
      ]),
    },
    {
      name: "Presupuestos",
      columns: [
        { header: "Plataforma", width: 12 },
        { header: "Cuenta", width: 30 },
        { header: "Campaña", width: 44 },
        { header: "Nivel", width: 10 },
        { header: "Conjunto/grupo", width: 30 },
        { header: "Tipo", width: 10 },
        { header: "Diario", width: 12 },
        { header: "Total", width: 12 },
        { header: "Diario estimado", width: 14 },
        { header: "Moneda", width: 8 },
        { header: "Compartido", width: 14 },
        { header: "Limitada", width: 10 },
      ],
      rows: r.budgets.map((b) => [
        b.platform,
        b.account_name,
        b.campaign_name,
        b.budget_level === "campaign" ? "Campaña" : "Conjunto",
        b.ad_set_name,
        b.budget_type === "daily" ? "Diario" : "Total",
        b.daily_budget,
        b.lifetime_budget,
        b.daily_estimate === null ? null : round(b.daily_estimate),
        b.currency,
        b.shared_budget_id,
        b.limited_by_budget === null ? null : b.limited_by_budget ? "Sí" : "No",
      ]),
    },
    {
      name: "Salud de entrega",
      columns: [
        { header: "Plataforma", width: 12 },
        { header: "Gravedad", width: 10 },
        { header: "Tipo", width: 18 },
        { header: "Nivel", width: 10 },
        { header: "Cuenta", width: 30 },
        { header: "Elemento", width: 44 },
        { header: "Código", width: 26 },
        { header: "Detalle", width: 60 },
      ],
      rows: r.signals.map((s) => [
        s.platform,
        { value: s.severity, tone: s.severity === "critical" ? "bad" : s.severity === "warning" ? "warn" : undefined },
        s.kind,
        s.entity_level,
        s.account_name,
        s.entity_name,
        s.code,
        s.detail,
      ]),
    },
    {
      name: "Avisos",
      columns: [
        { header: "Plataforma", width: 12 },
        { header: "Consulta", width: 14 },
        { header: "Código", width: 22 },
        { header: "Mensaje", width: 90 },
      ],
      rows: r.warnings.map((w) => [w.platform, w.check, w.code, w.message]),
    },
    {
      name: "Criterios",
      columns: [
        { header: "Concepto", width: 30 },
        { header: "Detalle", width: 100 },
      ],
      rows: [
        ["Generado", generatedAt],
        ["Día de rendimiento", r.date],
        [
          "Qué contiene",
          "Conteos, códigos de error y totales agregados. No incluye tokens, cabeceras ni respuestas crudas de las plataformas.",
        ],
        [
          "Conciliación",
          "Compara la hoja Rendimiento por cuenta contra cada interfaz con el mismo día, cuenta, moneda y zona horaria de la cuenta. Las monedas nunca se suman.",
        ],
        [
          "Conversiones",
          "Solo cuentan la acción principal configurada; sin ella quedan vacías (filas sin acción principal).",
        ],
      ],
    },
  ];
}
