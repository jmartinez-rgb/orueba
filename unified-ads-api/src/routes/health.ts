import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  uptime_s: z.number(),
  timestamp: z.string(),
});

/** Salud del servicio (sin llave): la usan Cloud Run, Docker y n8n para saber si la API está arriba. */
export const healthRoutes = (opts: { version: string; environment: string }): FastifyPluginAsyncZod =>
  async function health(app) {
    app.get(
      "/health",
      {
        schema: {
          tags: ["Sistema"],
          summary: "Salud del servicio",
          description: "Responde sin llave. No consulta a ninguna plataforma.",
          response: { 200: healthSchema },
        },
      },
      async () => ({
        status: "ok" as const,
        service: "unified-ads-api",
        version: opts.version,
        environment: opts.environment,
        uptime_s: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      }),
    );
  };
