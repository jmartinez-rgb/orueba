import Fastify, { LogController, type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { AppConfig } from "./config/env.js";
import { loggerOptions } from "./utils/logger.js";
import { ApiError } from "./utils/errors.js";
import { genRequestId } from "./middleware/request-id.js";
import { apiKeyGuard } from "./middleware/api-key.js";
import { registerErrorHandling } from "./middleware/error-handler.js";
import { ProviderRegistry } from "./providers/registry.js";
import { saveRotatedToken } from "./config/token-store.js";
import { ProviderStatusService } from "./services/provider-status.service.js";
import { healthRoutes } from "./routes/health.js";
import { providerRoutes } from "./routes/providers.js";
import { dataRoutes } from "./routes/data.js";

export interface AppDeps {
  registry?: ProviderRegistry;
}

/**
 * Construye la API: seguridad (Helmet, CORS, límite de solicitudes, X-API-Key), request_id,
 * errores estándar, documentación OpenAPI en /docs y las rutas /api/v1.
 */
export async function buildApp(config: AppConfig, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    genReqId: genRequestId,
    // genRequestId valida el encabezado entrante (un valor arbitrario no llega a los logs).
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: "request_id" }),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  // El request_id viaja en cada respuesta para rastrear una solicitud en los logs.
  app.addHook("onRequest", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });

  await app.register(helmet, {
    global: true,
    // Swagger UI usa estilos en línea; el resto de la API solo responde JSON.
    contentSecurityPolicy: {
      directives: { "style-src": ["'self'", "'unsafe-inline'"], "img-src": ["'self'", "data:"] },
    },
  });
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    errorResponseBuilder: (_req, ctx) =>
      new ApiError("RATE_LIMITED", `Límite de ${ctx.max} solicitudes por ${ctx.after} alcanzado.`, {
        retryAfter: Math.ceil(ctx.ttl / 1000),
      }),
  });
  app.addHook("onRequest", apiKeyGuard(config.apiKeyHashes));

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Unified Ads API",
        description:
          "API unificada de Google Ads, Meta, TikTok, Microsoft Advertising, Spotify y X. Autenticación interna con el encabezado X-API-Key. Todas las respuestas de error tienen la forma { error: { code, message, details?, request_id } }.",
        version: config.version,
      },
      components: { securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" } } },
      tags: [
        { name: "Sistema", description: "Salud y estado del servicio" },
        { name: "Proveedores", description: "Plataformas publicitarias y su estado de conexión" },
      ],
    },
    transform: jsonSchemaTransform,
  });
  if (config.docsEnabled) {
    await app.register(swaggerUi, {
      routePrefix: "/docs",
      // Política propia de la página de documentación: solo recursos locales (sin validador externo).
      staticCSP:
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
      uiConfig: { docExpansion: "list", deepLinking: false, validatorUrl: null },
    });
  }

  const registry =
    deps.registry ??
    ProviderRegistry.fromEnv(config.providerEnv, config.providerTimeoutMs, (variable, token) => {
      // Nunca se registra el valor; solo qué variable cambió.
      if (!config.tokenStoreFile) {
        app.log.warn(
          { variable },
          "La plataforma rotó el refresh token y no se conservará al reiniciar: configura TOKEN_STORE_FILE o vuelve a autorizar antes de que venza.",
        );
        return;
      }
      saveRotatedToken(config.tokenStoreFile, variable, token).then(
        () => app.log.info({ variable }, "refresh token rotado guardado en TOKEN_STORE_FILE"),
        () => app.log.error({ variable }, "no se pudo guardar el refresh token rotado en TOKEN_STORE_FILE"),
      );
    });
  const statuses = new ProviderStatusService(registry, config.providerTimeoutMs);
  await app.register(healthRoutes({ version: config.version, environment: config.env }), { prefix: "/api/v1" });
  await app.register(providerRoutes({ registry, statuses }), { prefix: "/api/v1" });
  await app.register(dataRoutes({ registry, timeoutMs: config.providerTimeoutMs }), { prefix: "/api/v1" });

  return app;
}
