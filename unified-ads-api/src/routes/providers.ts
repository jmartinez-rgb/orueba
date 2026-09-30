import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProviderStatusService } from "../services/provider-status.service.js";
import { ApiError } from "../utils/errors.js";
import { errorResponseSchema, providerSlugSchema, providerStatusSchema } from "./schemas.js";

const providerListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      enum: z.string(),
      name: z.string(),
      implemented: z.boolean(),
      status: providerStatusSchema,
    }),
  ),
  request_id: z.string(),
});

/** Proveedores disponibles y su estado de conexión. */
export const providerRoutes = (deps: {
  registry: ProviderRegistry;
  statuses: ProviderStatusService;
}): FastifyPluginAsyncZod =>
  async function providers(app) {
    const security = [{ ApiKeyAuth: [] }];

    app.get(
      "/providers",
      {
        schema: {
          tags: ["Proveedores"],
          summary: "Lista de proveedores y su estado",
          security,
          response: { 200: providerListSchema, 401: errorResponseSchema },
        },
      },
      async (req) => {
        const statuses = await deps.statuses.all();
        return {
          data: deps.registry.list().map((p, i) => ({
            id: p.slug,
            enum: p.id,
            name: p.name,
            implemented: p.implemented,
            status: statuses[i]!,
          })),
          request_id: req.id,
        };
      },
    );

    app.get(
      "/providers/:provider/status",
      {
        schema: {
          tags: ["Proveedores"],
          summary: "Estado de un proveedor",
          security,
          params: z.object({ provider: providerSlugSchema }),
          response: {
            200: z.object({ data: providerStatusSchema, request_id: z.string() }),
            400: errorResponseSchema,
            401: errorResponseSchema,
          },
        },
      },
      async (req) => {
        const provider = deps.registry.bySlug(req.params.provider);
        if (!provider) throw new ApiError("INVALID_REQUEST", `Proveedor desconocido: ${req.params.provider}.`);
        return { data: await deps.statuses.one(provider), request_id: req.id };
      },
    );
  };
