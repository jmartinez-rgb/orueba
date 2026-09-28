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

function executionFields() {
  return z.object({
    step: z.string(),
    platform: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    status: z.string(),
    lastRunAt: z.string(),
    rows: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    expectedEveryMinutes: z.string().nullable().optional(),
  });
}

function statusValues() {
  return z
    .object({
      ok: z.array(z.string()).default(["OK", "Listo", "Ejecutado", "Completado", "SUCCESS"]),
      partial: z.array(z.string()).default(["PARCIAL", "Parcial"]),
      pending: z.array(z.string()).default(["PENDIENTE", "Pendiente", "Por ejecutar"]),
      running: z.array(z.string()).default(["EJECUTANDO", "En proceso", "RUNNING"]),
      error: z.array(z.string()).default(["ERROR", "Error", "Falló", "FAILED"]),
    })
    .default({
      ok: ["OK", "Listo", "Ejecutado", "Completado", "SUCCESS"],
      partial: ["PARCIAL", "Parcial"],
      pending: ["PENDIENTE", "Pendiente", "Por ejecutar"],
      running: ["EJECUTANDO", "En proceso", "RUNNING"],
      error: ["ERROR", "Error", "Falló", "FAILED"],
    });
}

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
    /** Tipo de campaña (Google: SEARCH, PERFORMANCE_MAX…). Campo secundario de los clasificadores. */
    campaignType: fieldRef,
    /** Moneda de la cuenta (MXN / USD). Las cuentas en USD se convierten con la tasa del mes. */
    currency: fieldRef,
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
        /** Moneda del monto (MXN/USD). Sin columna se asume MXN. */
        currency: fieldRef,
      }),
    })
    .nullable()
    .optional(),
  /** Tasas de cambio mensuales USD→MXN (opcional: también se capturan en Settings). */
  fxRates: z
    .object({
      table: tableRef,
      fields: z.object({ month: z.string(), rate: z.string(), currency: fieldRef }),
    })
    .nullable()
    .optional(),
  /**
   * Hoja/tabla de control de ejecución: confirma si Dataslayer, Apps Script o la API ya corrieron.
   * Puede ser una tabla de BigQuery (incluida una tabla externa sobre Google Sheets) o la hoja de
   * Google Sheets directamente (lectura con la misma service account, permiso de lector).
   */
  executionControl: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("bigquery"),
        table: tableRef,
        fields: executionFields(),
        statusValues: statusValues(),
      }),
      z.object({
        type: z.literal("sheets"),
        spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{20,}$/, "spreadsheetId inválido"),
        /** Rango con encabezados en la primera fila, p. ej. "Control!A1:H50". */
        range: z.string().regex(/^[^;]{1,100}$/),
        /** Nombres de las columnas (encabezados) de la hoja. */
        fields: executionFields(),
        statusValues: statusValues(),
      }),
    ])
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
