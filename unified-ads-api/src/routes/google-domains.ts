import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { GOOGLE_ADS_DOMAIN_CONFIG, googleDomainConfigSchema } from "../config/google-domains.js";
import { errorResponseSchema } from "./schemas.js";

/** Internal metadata only. API-key guard applies; this never contacts Google or mutates accounts. */
export const googleDomainRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/google-domains",
    {
      schema: {
        tags: ["Datos"],
        security: [{ ApiKeyAuth: [] }],
        summary: "Configuración maestra de dominios Google de izzi y evaluación Absolute Top",
        response: {
          200: z.object({ data: googleDomainConfigSchema, request_id: z.string() }),
          401: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (req) => ({ data: GOOGLE_ADS_DOMAIN_CONFIG, request_id: req.id }),
  );
};
