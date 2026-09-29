import { z } from "zod";
import { BASE_METRICS, type BaseMetric } from "@/lib/types";

/**
 * Mapeo de la hoja de Google Sheets que llena Dataslayer (config/sheets.mapping.json).
 * Declara qué pestaña trae cada plataforma y cómo se llaman sus columnas; no contiene el ID
 * de la hoja (SHEETS_SPREADSHEET_ID) ni credenciales.
 *
 * - Una columna puede darse como texto o como lista de alternativas (se usa la primera que exista).
 * - Una métrica puede sumar varias columnas: {"sum": ["Compras Offline Web (Inbound)", "On-Facebook Purchase actions"]}.
 * - "pivot" convierte pestañas en formato largo (una fila por acción de conversión) en métricas.
 * - shape "daily": una fila por día (la de hoy es el acumulado al momento de la actualización).
 *   shape "hourly": una fila por hora (fecha + hora). level "account" sirve como curva horaria.
 */

const platformEnum = z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]);
const columnRef = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const metricRef = z.union([columnRef, z.object({ sum: z.array(z.string().min(1)).min(1) })]);

const metricColumns = Object.fromEntries(BASE_METRICS.map((m) => [m, metricRef.optional()])) as Record<BaseMetric, z.ZodOptional<typeof metricRef>>;

export const sheetSourceSchema = z.object({
  /** Nombre de la pestaña. */
  sheet: z.string().min(1),
  platform: platformEnum,
  shape: z.enum(["daily", "hourly"]).default("daily"),
  level: z.enum(["campaign", "account"]).default("campaign"),
  /** Si la pestaña no existe no es un error (p. ej. las pestañas por hora opcionales). */
  optional: z.boolean().default(false),
  /** Nombre de la consulta en la pestaña DataslayerQueries (por defecto, el de la pestaña). */
  controlName: z.string().optional(),
  /**
   * false = la plataforma entrega sus datos con un día de atraso (p. ej. Spotify): no se puede
   * vigilar dentro del día, así que queda fuera del monitoreo en vivo.
   */
  intraday: z.boolean().default(true),
  columns: z.object({
    date: columnRef,
    hour: columnRef.optional(),
    accountId: columnRef.optional(),
    accountName: columnRef.optional(),
    campaignId: columnRef.optional(),
    campaignName: columnRef.optional(),
    campaignStatus: columnRef.optional(),
    campaignType: columnRef.optional(),
    objective: columnRef.optional(),
    currency: columnRef.optional(),
    ...metricColumns,
  }),
  pivot: z
    .object({
      /** Columna con el nombre de la acción de conversión. */
      column: columnRef,
      /** Columna con el valor. */
      value: columnRef,
      /** Acción (texto exacto, sin distinguir mayúsculas) → métrica. */
      metrics: z.record(z.string(), z.enum(BASE_METRICS as unknown as [BaseMetric, ...BaseMetric[]])),
    })
    .optional(),
  /** Valores fijos cuando la pestaña no trae la columna (p. ej. Spotify sin cuenta). */
  constants: z
    .object({
      accountId: z.string().optional(),
      accountName: z.string().optional(),
      currency: z.enum(["MXN", "USD"]).optional(),
    })
    .default({}),
});

export const sheetsMappingSchema = z.object({
  /** Opcional: normalmente viene de SHEETS_SPREADSHEET_ID. */
  spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{20,}$/).optional(),
  /** Cada cuánto actualiza Dataslayer (minutos) y cuánto tarda en terminar. */
  refreshEveryMinutes: z.number().int().min(15).max(1440).default(120),
  refreshDurationMinutes: z.number().int().min(0).max(120).default(15),
  /** Segundos que se reutiliza una lectura de la hoja antes de volver a pedirla. */
  cacheSeconds: z.number().int().min(30).max(3600).default(300),
  /**
   * Días de historia que se leen de cada pestaña (las pestañas crecen todos los días). Vacío =
   * lo necesario para la comparación (semanas de Settings) y el mes en curso.
   */
  historyDays: z.number().int().min(14).max(800).optional(),
  /** Métrica monitoreada por omisión cuando la hoja no trae la del objetivo de la plataforma (p. ej. TikTok sin leads). */
  defaultKpi: z.partialRecord(z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]), z.enum(["conversions", "sales", "whatsapp", "leads", "calls", "purchases", "clicks", "impressions"])).default({}),
  /** Métricas que llegan con retraso por plataforma (conversiones offline): en el día no se evalúan. */
  laggingMetrics: z.partialRecord(z.enum(["google", "meta", "tiktok", "microsoft", "spotify", "x"]), z.array(z.enum(BASE_METRICS as unknown as [BaseMetric, ...BaseMetric[]]))).default({}),
  control: z
    .object({
      sheet: z.string().default("DataslayerQueries"),
      /** "sheet" = zona horaria de la hoja (Archivo → Configuración). */
      timeZone: z.string().default("sheet"),
      columns: z
        .object({
          sheet: columnRef.default("Sheet name"),
          updated: columnRef.default("Updated"),
          /** Si una consulta recién creada aún no tiene "Updated", se usa su hora de creación. */
          created: columnRef.default("Created"),
          status: columnRef.default("Last status"),
          dataSource: columnRef.default("Data source"),
          range: columnRef.default("Range address"),
        })
        .default({ sheet: "Sheet name", updated: "Updated", created: "Created", status: "Last status", dataSource: "Data source", range: "Range address" }),
    })
    .nullable()
    .default({
      sheet: "DataslayerQueries",
      timeZone: "sheet",
      columns: { sheet: "Sheet name", updated: "Updated", created: "Created", status: "Last status", dataSource: "Data source", range: "Range address" },
    }),
  sources: z.array(sheetSourceSchema).min(1),
  budgets: z
    .object({
      sheet: z.string(),
      optional: z.boolean().default(true),
      columns: z.object({
        month: columnRef,
        amount: columnRef,
        level: columnRef.optional(),
        platform: columnRef.optional(),
        account: columnRef.optional(),
        campaign: columnRef.optional(),
        currency: columnRef.optional(),
        /** Opcional: "izzi" o "Sky". Sin columna, la marca sale del nombre de la cuenta o campaña. */
        brand: columnRef.optional(),
      }),
    })
    .nullable()
    .default(null),
  fxRates: z
    .object({
      sheet: z.string(),
      optional: z.boolean().default(true),
      columns: z.object({ month: columnRef, rate: columnRef }),
    })
    .nullable()
    .default(null),
});

export type SheetSource = z.infer<typeof sheetSourceSchema>;
export type SheetsMapping = z.infer<typeof sheetsMappingSchema>;
export type ColumnRef = z.infer<typeof columnRef>;
export type MetricRef = z.infer<typeof metricRef>;

export function parseSheetsMapping(raw: string | undefined): { mapping: SheetsMapping | null; errors: string[] } {
  if (!raw) return { mapping: null, errors: ["No se encontró el mapeo de la hoja (config/sheets.mapping.json o SHEETS_MAPPING)."] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { mapping: null, errors: ["El mapeo de la hoja no es JSON válido."] };
  }
  const parsed = sheetsMappingSchema.safeParse(json);
  if (!parsed.success) return { mapping: null, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "mapeo"}: ${i.message}`) };
  return { mapping: parsed.data, errors: [] };
}
