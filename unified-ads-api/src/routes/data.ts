import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { ProviderRegistry } from "../providers/registry.js";
import type { AdsProvider } from "../providers/provider.js";
import { ApiError, errorBody } from "../utils/errors.js";
import { withTimeout } from "../utils/timeout.js";
import { errorResponseSchema, providerSlugSchema } from "./schemas.js";

const text = z.string().nullable();
const number = z.number().finite().nullable();
const accountQuery = z.object({
  provider: providerSlugSchema.optional(),
  client_id: z.string().min(1).max(120).optional(),
});
const campaignQuery = accountQuery.extend({
  account_id: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .optional(),
});
const performanceQuery = campaignQuery
  .extend({
    campaign_id: z
      .string()
      .regex(/^[\w-]{1,80}$/)
      .optional(),
    date_from: z.iso.date(),
    date_to: z.iso.date(),
    granularity: z.enum(["daily", "hourly"]).default("daily"),
  })
  .refine((q) => q.date_from <= q.date_to && (Date.parse(q.date_to) - Date.parse(q.date_from)) / 86400000 <= 365, {
    message: "Fechas desordenadas o rango mayor a 366 días.",
    path: ["date_to"],
  });
const status = z.enum(["active", "paused", "removed", "unknown"]);
const account = z.object({
  platform: providerSlugSchema,
  client_id: text,
  account_id: z.string(),
  account_name: z.string(),
  currency: text,
  timezone: text,
  status: text,
  manager_account_id: text,
  is_manager: z.boolean().optional(),
});
const campaign = z.object({
  platform: providerSlugSchema,
  client_id: text,
  account_id: z.string(),
  campaign_id: z.string(),
  campaign_name: z.string(),
  campaign_status: status,
  source_status: text,
  objective: text,
});
const raw = z.record(z.string(), z.unknown());
const budget = z.object({
  platform: providerSlugSchema,
  client_id: text,
  account_id: z.string(),
  account_name: z.string(),
  currency: text,
  campaign_id: z.string(),
  campaign_name: z.string(),
  objective: text,
  budget_level: z.enum(["campaign", "ad_set"]),
  ad_set_id: text,
  ad_set_name: text,
  budget_type: z.enum(["daily", "lifetime"]),
  daily_budget: number,
  lifetime_budget: number,
  budget_remaining: number,
  daily_estimate: number,
  shared_budget_id: text,
  limited_by_budget: z.boolean().nullable(),
  recommended_daily_budget: number,
  start_time: text,
  end_time: text,
  extracted_at: z.string(),
  raw_metrics: raw,
});
const performance = z.object({
  platform: providerSlugSchema,
  client_id: text,
  account_id: z.string(),
  account_name: text,
  campaign_id: text,
  campaign_name: text,
  campaign_status: status.nullable(),
  objective: text,
  date: z.iso.date(),
  hour: z.number().int().min(0).max(23).nullable(),
  currency: text,
  spend: number,
  impressions: number,
  reach: number,
  frequency: number,
  clicks: number,
  link_clicks: number,
  conversions: number,
  conversion_value: number,
  ctr: number,
  cpc: number,
  cpm: number,
  cpa: number,
  video_views: number,
  video_25: number,
  video_50: number,
  video_75: number,
  video_100: number,
  source_timezone: text,
  extracted_at: z.string(),
  raw_metrics: raw,
});
const conversion = z.object({
  platform: providerSlugSchema,
  client_id: text,
  account_id: z.string(),
  campaign_id: text,
  date: z.iso.date(),
  hour: z.number().int().min(0).max(23).nullable(),
  source_conversion: z.string(),
  normalized_conversion: text,
  conversions: number,
  conversion_value: number,
  extracted_at: z.string(),
  raw_metrics: raw.optional(),
});

export const dataRoutes = (deps: { registry: ProviderRegistry; timeoutMs: number }): FastifyPluginAsyncZod =>
  async function dataRoutesPlugin(app) {
    async function collect<T>(
      provider: string | undefined,
      requestId: string,
      work: (p: AdsProvider, signal: AbortSignal, onWarning: (error: ApiError) => void) => Promise<T[]>,
      supports: (p: AdsProvider) => boolean = () => true,
    ) {
      const invoke = async (p: AdsProvider) => {
        const errors: Array<{ provider: string; error: ReturnType<typeof errorBody>["error"] }> = [];
        // El proveedor corta primero con su propio límite; la ruta deja un margen para recibir su error.
        const limit = Math.max(deps.timeoutMs, p.timeoutMs ?? 0) + 1000;
        const data = await withTimeout(
          work(p, AbortSignal.timeout(limit), (warning) => {
            errors.push({ provider: p.slug, error: errorBody(warning, requestId).error });
          }),
          limit,
          p.name,
        );
        return { data, errors };
      };
      if (provider) {
        const p = deps.registry.bySlug(provider);
        if (!p) throw new ApiError("INVALID_REQUEST", "Proveedor desconocido.");
        if (!supports(p)) throw new ApiError("INVALID_REQUEST", `${p.name} no ofrece esta consulta todavía.`);
        return {
          ...(await invoke(p)),
          request_id: requestId,
        };
      }
      // Sin proveedor explícito solo se consultan las integraciones listas y configuradas; su estado
      // completo (incluidas las pendientes) está en /providers. Así `errors` no se llena de avisos fijos.
      const providers = deps.registry.list().filter((p) => p.implemented && p.isConfigured() && supports(p));
      const results = await Promise.allSettled(providers.map(invoke));
      const data: T[] = [];
      const errors: Array<{ provider: string; error: ReturnType<typeof errorBody>["error"] }> = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
          data.push(...result.value.data);
          errors.push(...result.value.errors);
        } else {
          const err = result.reason instanceof ApiError ? result.reason : new ApiError("UNKNOWN");
          errors.push({ provider: providers[i]!.slug, error: errorBody(err, requestId).error });
        }
      });
      return { data, errors, request_id: requestId };
    }
    const response = (item: z.ZodType) => ({
      200: z.object({
        data: z.array(item),
        errors: z.array(z.object({ provider: z.string(), error: errorResponseSchema.shape.error })),
        request_id: z.string(),
      }),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      429: errorResponseSchema,
      502: errorResponseSchema,
      503: errorResponseSchema,
      504: errorResponseSchema,
    });
    const common = { tags: ["Datos"], security: [{ ApiKeyAuth: [] }] };
    app.get(
      "/accounts",
      {
        schema: {
          ...common,
          summary: "Cuentas publicitarias y MCC",
          querystring: accountQuery,
          response: response(account),
        },
      },
      async (req) =>
        collect(req.query.provider, req.id, (p, signal, onWarning) => p.listAccounts(req.query, { signal, onWarning })),
    );
    app.get(
      "/campaigns",
      {
        schema: {
          ...common,
          summary: "Campañas por cuenta o cliente",
          querystring: campaignQuery,
          response: response(campaign),
        },
      },
      async (req) =>
        collect(req.query.provider, req.id, (p, signal, onWarning) =>
          p.listCampaigns(req.query, { signal, onWarning }),
        ),
    );
    app.get(
      "/budgets",
      {
        schema: {
          ...common,
          summary: "Presupuestos vigentes de campañas y conjuntos activos (hoy: Meta)",
          querystring: campaignQuery,
          response: response(budget),
        },
      },
      async (req) =>
        collect(
          req.query.provider,
          req.id,
          (p, signal, onWarning) => p.listBudgets!(req.query, { signal, onWarning }),
          (p) => typeof p.listBudgets === "function",
        ),
    );
    app.get(
      "/performance",
      {
        schema: {
          ...common,
          summary: "Rendimiento diario u horario en moneda original",
          querystring: performanceQuery,
          response: response(performance),
        },
      },
      async (req) =>
        collect(req.query.provider, req.id, (p, signal, onWarning) =>
          p.getPerformance(req.query, { signal, onWarning }),
        ),
    );
    app.get(
      "/conversions",
      {
        schema: {
          ...common,
          summary: "Conversiones por acción (sin mezclar costos)",
          querystring: performanceQuery,
          response: response(conversion),
        },
      },
      async (req) =>
        collect(req.query.provider, req.id, (p, signal, onWarning) =>
          p.getConversions(req.query, { signal, onWarning }),
        ),
    );
  };
