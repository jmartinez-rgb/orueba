import { z } from "zod";

/**
 * Mapeo configurable del esquema de BigQuery.
 *
 * La app NO asume nombres de tablas ni de columnas: todo se declara aquí (variable
 * BIGQUERY_MAPPING con un JSON, o el archivo config/bigquery.mapping.example.json como
 * punto de partida). Soporta:
 *  - una o varias tablas/vistas de métricas (p. ej. una por plataforma) que se unen;
 *  - forma "hourly" (una fila por hora) o "cumulative_snapshot" (cortes acumulados del día,
 *    como una carga cada 2 horas);
 *  - fecha/hora locales o timestamp UTC convertido con la zona de negocio;
 *  - expresiones opcionales (p. ej. cost_micros / 1e6) si se habilitan explícitamente.
 */

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/, "Identificador inválido");
const tableRef = z.string().regex(/^[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+){0,2}$/, "Referencia de tabla inválida");
const platformEnum = z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]);

/** Un campo puede ser una columna o, si allowExpressions=true, una expresión SQL simple. */
const fieldRef = z.string().min(1).nullable().optional();

export const metricSourceSchema = z.object({
  name: z.string().default("metrics"),
  table: tableRef,
  shape: z.enum(["hourly", "cumulative_snapshot"]).default("hourly"),
  /** Si la tabla es de una sola plataforma (p. ej. master_meta), se fija aquí. */
  platformConstant: platformEnum.nullable().optional(),
  allowExpressions: z.boolean().default(false),
  /** Cómo interpretar el timestamp: UTC (se convierte a la zona de negocio) o ya local. */
  timestampTimezone: z.enum(["UTC", "local"]).default("UTC"),
  partition: z
    .object({
      field: identifier,
      type: z.enum(["DATE", "TIMESTAMP", "DATETIME"]).default("DATE"),
    })
    .nullable()
    .optional(),
  fields: z.object({
    /** Fecha de negocio (DATE). Si no existe, se deriva del timestamp. */
    date: fieldRef,
    /** Hora local 0..23 (forma hourly). Si no existe, se deriva del timestamp. */
    hour: fieldRef,
    /** Timestamp de la fila / del corte (obligatorio para cumulative_snapshot). */
    timestamp: fieldRef,
    /** Momento de carga (para frescura y deduplicación). */
    ingestedAt: fieldRef,
    platform: fieldRef,
    accountId: fieldRef,
    accountName: fieldRef,
    campaignId: z.string().min(1),
    campaignName: fieldRef,
    campaignStatus: fieldRef,
    objective: fieldRef,
    spend: z.string().min(1),
    impressions: fieldRef,
    clicks: fieldRef,
    conversions: fieldRef,
    leads: fieldRef,
    sales: fieldRef,
    whatsapp: fieldRef,
    calls: fieldRef,
    purchases: fieldRef,
    revenue: fieldRef,
  }),
  /** Valores de plataforma propios de la fuente: {"facebook": "meta", "bing": "microsoft"}. */
  platformValues: z.record(z.string(), platformEnum).default({}),
  /** Deduplicación opcional: solo si la llave identifica una fila única. */
  dedupe: z
    .object({
      orderBy: identifier,
    })
    .nullable()
    .optional(),
});

export const bigQueryMappingSchema = z.object({
  metricSources: z.array(metricSourceSchema).min(1),
  budgets: z
    .object({
      table: tableRef,
      fields: z.object({
        month: z.string(),
        level: fieldRef,
        platform: fieldRef,
        accountId: fieldRef,
        campaignId: fieldRef,
        amount: z.string(),
      }),
    })
    .nullable()
    .optional(),
  syncLog: z
    .object({
      table: tableRef,
      fields: z.object({
        platform: z.string(),
        accountId: fieldRef,
        workflow: fieldRef,
        startedAt: z.string(),
        finishedAt: fieldRef,
        status: z.string(),
        rowsLoaded: fieldRef,
        message: fieldRef,
      }),
      /** Valores de estado que significan éxito / error. */
      successValues: z.array(z.string()).default(["SUCCESS", "success", "OK", "ok"]),
      failureValues: z.array(z.string()).default(["FAILED", "failed", "ERROR", "error"]),
    })
    .nullable()
    .optional(),
  /** Tablas propias de la app (alertas, incidentes, notificaciones, corridas, configuración). */
  state: z
    .object({
      alerts: z.string().default("monitoring_alerts"),
      incidents: z.string().default("monitoring_incidents"),
      notifications: z.string().default("monitoring_notifications"),
      runs: z.string().default("monitoring_runs"),
      settings: z.string().default("monitoring_settings"),
    })
    .default({
      alerts: "monitoring_alerts",
      incidents: "monitoring_incidents",
      notifications: "monitoring_notifications",
      runs: "monitoring_runs",
      settings: "monitoring_settings",
    }),
});

export type BigQueryMapping = z.infer<typeof bigQueryMappingSchema>;
export type MetricSourceMapping = z.infer<typeof metricSourceSchema>;

export interface MappingResult {
  mapping: BigQueryMapping | null;
  errors: string[];
}

export function parseMapping(json: string | undefined): MappingResult {
  if (!json) return { mapping: null, errors: ["Falta el mapeo de BigQuery (BIGQUERY_MAPPING o config/bigquery.mapping.json): declara tablas y columnas."] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { mapping: null, errors: ["BIGQUERY_MAPPING no es un JSON válido."] };
  }
  const parsed = bigQueryMappingSchema.safeParse(raw);
  if (!parsed.success) {
    return { mapping: null, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const errors: string[] = [];
  for (const src of parsed.data.metricSources) {
    if (src.shape === "cumulative_snapshot" && !src.fields.timestamp) errors.push(`${src.name}: cumulative_snapshot requiere fields.timestamp.`);
    if (!src.fields.date && !src.fields.timestamp) errors.push(`${src.name}: se necesita fields.date o fields.timestamp.`);
    if (src.shape === "hourly" && !src.fields.hour && !src.fields.timestamp) errors.push(`${src.name}: la forma hourly requiere fields.hour o fields.timestamp.`);
    if (!src.platformConstant && !src.fields.platform) errors.push(`${src.name}: define fields.platform o platformConstant.`);
    for (const [k, v] of Object.entries(src.fields)) {
      if (typeof v !== "string") continue;
      if (!src.allowExpressions && !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(v)) {
        errors.push(`${src.name}.fields.${k}: "${v}" no es una columna simple (activa allowExpressions para usar expresiones).`);
      }
      if (/;|--|\/\*|\*\/|\b(insert|update|delete|merge|drop|create|alter|grant|truncate)\b/i.test(v)) {
        errors.push(`${src.name}.fields.${k}: expresión no permitida.`);
      }
    }
  }
  return errors.length ? { mapping: null, errors } : { mapping: parsed.data, errors: [] };
}
