import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";
import { ApiError, errorBody } from "../utils/errors.js";

/**
 * Manejador global: toda respuesta de error tiene la forma estándar y el request_id. Los errores
 * inesperados se registran con detalle, pero al cliente solo le llega un mensaje genérico.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError | Error, req, reply) => {
    let apiError: ApiError;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (hasZodFastifySchemaValidationErrors(error)) {
      apiError = new ApiError("INVALID_REQUEST", "Parámetros inválidos.", {
        details: error.validation.map((v) => ({
          path: v.instancePath.replace(/^\//, "").replaceAll("/", "."),
          message: v.message ?? "Valor inválido.",
        })),
      });
    } else if ((error as FastifyError).statusCode === 429) {
      apiError = new ApiError("RATE_LIMITED", undefined, {
        retryAfter: Number(reply.getHeader("retry-after")) || null,
      });
    } else if ((error as FastifyError).validation) {
      apiError = new ApiError("INVALID_REQUEST", error.message);
    } else if (
      typeof (error as FastifyError).statusCode === "number" &&
      (error as FastifyError).statusCode! >= 400 &&
      (error as FastifyError).statusCode! < 500
    ) {
      apiError = new ApiError("INVALID_REQUEST", error.message, { statusCode: (error as FastifyError).statusCode });
    } else {
      apiError = new ApiError("UNKNOWN");
    }

    if (apiError.statusCode >= 500 || isResponseSerializationError(error))
      req.log.error({ err: error, code: apiError.code }, "request failed");
    else req.log.warn({ code: apiError.code, message: apiError.message }, "request rejected");

    if (apiError.retryAfter !== null) void reply.header("retry-after", String(apiError.retryAfter));
    void reply.status(apiError.statusCode).send(errorBody(apiError, req.id));
  });

  app.setNotFoundHandler((req, reply) => {
    const err = new ApiError("INVALID_REQUEST", `No existe la ruta ${req.method} ${req.url.split("?")[0]}.`, {
      statusCode: 404,
    });
    void reply.status(404).send(errorBody(err, req.id));
  });
}
