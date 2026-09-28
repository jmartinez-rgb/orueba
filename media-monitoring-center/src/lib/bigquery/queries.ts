import type { BaseMetric, EntityLevel } from "@/lib/types";
import { BASE_METRICS } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import type { BigQueryMapping, MetricSourceMapping } from "./mapping";

/**
 * Constructores de SQL (puros y testeables). Reglas de costo:
 *  - nunca SELECT *: solo las columnas mapeadas;
 *  - siempre filtro de partición / rango de fechas;
 *  - agregación en BigQuery (SUM respeta NULL: si todas las filas son NULL devuelve NULL);
 *  - parámetros con nombre (@dates, @tz...) en lugar de concatenar valores.
 */

export type TableResolver = (ref: string) => string;

const METRIC_FIELD: Record<BaseMetric, keyof MetricSourceMapping["fields"]> = {
  spend: "spend",
  impressions: "impressions",
  clicks: "clicks",
  conversions: "conversions",
  leads: "leads",
  sales: "sales",
  whatsapp: "whatsapp",
  calls: "calls",
  purchases: "purchases",
  revenue: "revenue",
};

function field(src: MetricSourceMapping, key: keyof MetricSourceMapping["fields"]): string | null {
  const v = src.fields[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function sqlString(v: string): string {
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** CASE que traduce los nombres de plataforma de la fuente a los ids internos. */
export function platformCase(rawExpr: string, extra: Record<string, string>): string {
  const pairs = new Map<string, string>();
  for (const p of Object.values(PLATFORMS)) for (const a of [p.id, ...p.sourceAliases]) pairs.set(a.toLowerCase(), p.id);
  for (const [k, v] of Object.entries(extra)) pairs.set(k.toLowerCase(), v);
  const whens = [...pairs.entries()].map(([k, v]) => `WHEN ${sqlString(k)} THEN ${sqlString(v)}`).join(" ");
  return `CASE LOWER(TRIM(CAST(${rawExpr} AS STRING))) ${whens} ELSE LOWER(TRIM(CAST(${rawExpr} AS STRING))) END`;
}

function timestampExpr(src: MetricSourceMapping): string | null {
  const ts = field(src, "timestamp");
  if (!ts) return null;
  return src.timestampTimezone === "local" ? `TIMESTAMP(DATETIME(${ts}), @tz)` : `CAST(${ts} AS TIMESTAMP)`;
}

function dateExpr(src: MetricSourceMapping): string {
  const d = field(src, "date");
  if (d) return `CAST(${d} AS DATE)`;
  return `DATE(${timestampExpr(src)}, @tz)`;
}

function hourExpr(src: MetricSourceMapping): string {
  const h = field(src, "hour");
  if (h) return `CAST(${h} AS INT64)`;
  const ts = timestampExpr(src);
  return ts ? `EXTRACT(HOUR FROM DATETIME(${ts}, @tz))` : "CAST(NULL AS INT64)";
}

/** Filtro de partición. Con partición DATE usa IN UNNEST (poda de particiones exacta). */
function partitionFilter(src: MetricSourceMapping, mode: "dates" | "range"): string {
  const p = src.partition;
  if (!p) {
    // Sin partición declarada se filtra por la fecha derivada (más costoso: documentado).
    return mode === "dates" ? `${dateExpr(src)} IN UNNEST(@partition_dates)` : `${dateExpr(src)} BETWEEN DATE_SUB(@from_date, INTERVAL 1 DAY) AND DATE_ADD(@to_date, INTERVAL 1 DAY)`;
  }
  if (p.type === "DATE") {
    return mode === "dates" ? `${p.field} IN UNNEST(@partition_dates)` : `${p.field} BETWEEN DATE_SUB(@from_date, INTERVAL 1 DAY) AND DATE_ADD(@to_date, INTERVAL 1 DAY)`;
  }
  const cast = p.type === "TIMESTAMP" ? "TIMESTAMP" : "DATETIME";
  const from = mode === "dates" ? "@min_date" : "@from_date";
  const to = mode === "dates" ? "@max_date" : "@to_date";
  return `${p.field} >= ${cast}(DATE_SUB(${from}, INTERVAL 1 DAY)) AND ${p.field} < ${cast}(DATE_ADD(${to}, INTERVAL 2 DAY))`;
}

/** SELECT normalizado de una fuente: mismas columnas para cualquier tabla de origen. */
export function normalizedSelect(src: MetricSourceMapping, resolve: TableResolver, mode: "dates" | "range"): string {
  const platformRaw = src.platformConstant ? sqlString(src.platformConstant) : field(src, "platform")!;
  const ts = timestampExpr(src);
  const ingested = field(src, "ingestedAt");
  const cols = [
    `${dateExpr(src)} AS d`,
    `${hourExpr(src)} AS h`,
    `${ts ?? "CAST(NULL AS TIMESTAMP)"} AS snapshot_ts`,
    `${src.platformConstant ? sqlString(src.platformConstant) : platformCase(platformRaw, src.platformValues)} AS platform`,
    `CAST(${field(src, "accountId") ?? "NULL"} AS STRING) AS account_id`,
    `CAST(${field(src, "accountName") ?? "NULL"} AS STRING) AS account_name`,
    `CAST(${field(src, "campaignId")} AS STRING) AS campaign_id`,
    `CAST(${field(src, "campaignName") ?? "NULL"} AS STRING) AS campaign_name`,
    `CAST(${field(src, "campaignStatus") ?? "NULL"} AS STRING) AS campaign_status`,
    `CAST(${field(src, "objective") ?? "NULL"} AS STRING) AS objective`,
    `${ingested ? `CAST(${ingested} AS TIMESTAMP)` : "CAST(NULL AS TIMESTAMP)"} AS ingested_at`,
    ...BASE_METRICS.map((m) => {
      const f = field(src, METRIC_FIELD[m]);
      return f ? `CAST(${f} AS FLOAT64) AS ${m}` : `CAST(NULL AS FLOAT64) AS ${m}`;
    }),
  ];
  return `SELECT ${cols.join(",\n    ")}\n  FROM ${resolve(src.table)}\n  WHERE ${partitionFilter(src, mode)}`;
}

function unionOf(sources: MetricSourceMapping[], resolve: TableResolver, mode: "dates" | "range"): string {
  return sources.map((s) => normalizedSelect(s, resolve, mode)).join("\n  UNION ALL\n  ");
}

function levelColumns(level: EntityLevel): { select: string; group: string } {
  if (level === "platform") return { select: "platform, CAST(NULL AS STRING) AS account_id, CAST(NULL AS STRING) AS campaign_id", group: "platform" };
  if (level === "account") return { select: "platform, account_id, CAST(NULL AS STRING) AS campaign_id", group: "platform, account_id" };
  return { select: "platform, account_id, campaign_id", group: "platform, account_id, campaign_id" };
}

const sums = BASE_METRICS.map((m) => `SUM(${m}) AS ${m}`).join(", ");
const cols = BASE_METRICS.join(", ");

/** Filas horarias agregadas al nivel pedido (fuentes con forma hourly). */
export function hourlyQuery(sources: MetricSourceMapping[], resolve: TableResolver, level: EntityLevel, withPlatformFilter: boolean): string {
  const lv = levelColumns(level);
  const dedupe = sources.some((s) => s.dedupe);
  return `WITH src AS (
  ${unionOf(sources, resolve, "dates")}
), base AS (
  SELECT * FROM src
  WHERE d IN UNNEST(@dates)${withPlatformFilter ? " AND platform IN UNNEST(@platforms)" : ""}
)${
    dedupe
      ? `, dedup AS (
  SELECT * FROM base
  QUALIFY ROW_NUMBER() OVER (PARTITION BY d, h, platform, account_id, campaign_id ORDER BY ingested_at DESC) = 1
)`
      : ""
  }
SELECT d AS date, h AS hour, ${lv.select}, ${sums}
FROM ${dedupe ? "dedup" : "base"}
WHERE h BETWEEN 0 AND 23
GROUP BY date, hour, ${lv.group}`;
}

/**
 * Cortes acumulados (forma cumulative_snapshot): último corte por hora de cobertura.
 * Un corte a las 11:54 con tolerancia de 15 min cubre la ventana 00:00–12:00.
 */
export function snapshotQuery(sources: MetricSourceMapping[], resolve: TableResolver, withPlatformFilter: boolean): string {
  return `WITH src AS (
  ${unionOf(sources, resolve, "dates")}
), base AS (
  SELECT *,
    IF(DATE(DATETIME(TIMESTAMP_ADD(snapshot_ts, INTERVAL @tolerance_min MINUTE), @tz)) > d, 24,
       EXTRACT(HOUR FROM DATETIME(TIMESTAMP_ADD(snapshot_ts, INTERVAL @tolerance_min MINUTE), @tz))) AS cover_h
  FROM src
  WHERE d IN UNNEST(@dates)${withPlatformFilter ? " AND platform IN UNNEST(@platforms)" : ""}
)
SELECT d AS date, cover_h, platform, account_id, campaign_id, ${cols}
FROM base
QUALIFY ROW_NUMBER() OVER (PARTITION BY d, cover_h, platform, account_id, campaign_id ORDER BY snapshot_ts DESC) = 1`;
}

/** Totales diarios por nivel en un rango de fechas. */
export function dailyQuery(sources: MetricSourceMapping[], resolve: TableResolver, level: EntityLevel, withPlatformFilter: boolean): string {
  const lv = levelColumns(level);
  const snapshot = sources[0]?.shape === "cumulative_snapshot";
  const filter = `d BETWEEN @from_date AND @to_date${withPlatformFilter ? " AND platform IN UNNEST(@platforms)" : ""}`;
  if (snapshot) {
    return `WITH src AS (
  ${unionOf(sources, resolve, "range")}
), last_cut AS (
  SELECT * FROM src WHERE ${filter}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY d, platform, account_id, campaign_id ORDER BY snapshot_ts DESC) = 1
)
SELECT d AS date, ${lv.select}, ${sums}
FROM last_cut
GROUP BY date, ${lv.group}`;
  }
  return `WITH src AS (
  ${unionOf(sources, resolve, "range")}
)
SELECT d AS date, ${lv.select}, ${sums}
FROM src
WHERE ${filter}
GROUP BY date, ${lv.group}`;
}

/** Último dato recibido por plataforma y por cuenta. */
export function freshnessQuery(sources: MetricSourceMapping[], resolve: TableResolver): string {
  const hourEnd = "TIMESTAMP(DATETIME_ADD(DATETIME(d, TIME(IFNULL(h, 0), 0, 0)), INTERVAL 1 HOUR), @tz)";
  return `WITH src AS (
  ${unionOf(sources, resolve, "range")}
)
SELECT platform, account_id, MAX(COALESCE(ingested_at, snapshot_ts, ${hourEnd})) AS last_data_at
FROM src
WHERE d BETWEEN @from_date AND @to_date
GROUP BY ROLLUP(platform, account_id)
HAVING platform IS NOT NULL`;
}

/** Catálogo derivado de las métricas recientes (si no hay tabla de campañas). */
export function catalogQuery(sources: MetricSourceMapping[], resolve: TableResolver): string {
  return `WITH src AS (
  ${unionOf(sources, resolve, "range")}
)
SELECT platform, account_id, ANY_VALUE(account_name) AS account_name, campaign_id,
  ANY_VALUE(campaign_name) AS campaign_name, ANY_VALUE(campaign_status) AS campaign_status,
  ANY_VALUE(objective) AS objective, MAX(d) AS last_seen,
  SUM(IF(d >= DATE_SUB(@to_date, INTERVAL 2 DAY), spend, 0)) AS recent_spend
FROM src
WHERE d BETWEEN @from_date AND @to_date AND campaign_id IS NOT NULL
GROUP BY platform, account_id, campaign_id`;
}

/** Chequeos de calidad del día: nulos, duplicados (si hay llave única) y carga de la última hora. */
export function dataQualityQuery(sources: MetricSourceMapping[], resolve: TableResolver): string {
  const dedupe = sources.some((s) => s.dedupe);
  return `WITH src AS (
  ${unionOf(sources, resolve, "dates")}
)
SELECT platform,
  COUNTIF(spend IS NULL) AS null_spend_rows,
  ${dedupe ? "COUNT(*) - COUNT(DISTINCT CONCAT(CAST(h AS STRING), '|', IFNULL(account_id, ''), '|', IFNULL(campaign_id, '')))" : "0"} AS duplicate_rows,
  COUNT(DISTINCT IF(h = @last_hour, campaign_id, NULL)) AS last_hour_rows,
  COUNT(DISTINCT IF(h BETWEEN @last_hour - 3 AND @last_hour - 1, campaign_id, NULL)) AS expected_last_hour_rows
FROM src
WHERE d = @date
GROUP BY platform`;
}

export function budgetsQuery(mapping: NonNullable<BigQueryMapping["budgets"]>, resolve: TableResolver): string {
  const f = mapping.fields;
  const level = f.level
    ? `LOWER(CAST(${f.level} AS STRING))`
    : `CASE WHEN ${f.campaignId ?? "NULL"} IS NOT NULL THEN 'campaign' WHEN ${f.accountId ?? "NULL"} IS NOT NULL THEN 'account' WHEN ${f.platform ?? "NULL"} IS NOT NULL THEN 'platform' ELSE 'total' END`;
  return `SELECT SUBSTR(CAST(${f.month} AS STRING), 1, 7) AS month, ${level} AS level,
  ${f.platform ? platformCase(f.platform, {}) : "CAST(NULL AS STRING)"} AS platform,
  CAST(${f.accountId ?? "NULL"} AS STRING) AS account_id,
  CAST(${f.campaignId ?? "NULL"} AS STRING) AS campaign_id,
  CAST(${f.amount} AS FLOAT64) AS amount
FROM ${resolve(mapping.table)}
WHERE SUBSTR(CAST(${f.month} AS STRING), 1, 7) = @month`;
}

export function syncLogQuery(mapping: NonNullable<BigQueryMapping["syncLog"]>, resolve: TableResolver): string {
  const f = mapping.fields;
  return `SELECT ${platformCase(f.platform, {})} AS platform,
  CAST(${f.accountId ?? "NULL"} AS STRING) AS account_id,
  CAST(${f.workflow ?? "NULL"} AS STRING) AS workflow,
  CAST(${f.startedAt} AS TIMESTAMP) AS started_at,
  CAST(${f.finishedAt ?? "NULL"} AS TIMESTAMP) AS finished_at,
  CAST(${f.status} AS STRING) AS status,
  CAST(${f.rowsLoaded ?? "NULL"} AS INT64) AS rows_loaded,
  CAST(${f.message ?? "NULL"} AS STRING) AS message
FROM ${resolve(mapping.table)}
WHERE CAST(${f.startedAt} AS TIMESTAMP) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY)
ORDER BY started_at DESC
LIMIT @limit`;
}
