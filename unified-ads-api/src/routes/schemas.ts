import { z } from "zod";
import { ERROR_CODES } from "../utils/errors.js";
import { PROVIDER_SLUGS } from "../types/providers.js";

export const providerSlugSchema = z.enum(PROVIDER_SLUGS as unknown as ["google", ...string[]]);

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
      request_id: z.string(),
    }),
  })
  .describe("Error estándar");

export const providerStatusSchema = z.object({
  provider: z.string(),
  name: z.string(),
  state: z.enum([
    "connected",
    "degraded",
    "not_configured",
    "not_implemented",
    "access_required",
    "permission_denied",
    "error",
  ]),
  configured: z.boolean(),
  implemented: z.boolean(),
  missing_config: z.array(z.string()),
  last_successful_sync: z.string().nullable(),
  last_error: z.object({ code: z.string(), message: z.string(), at: z.string() }).nullable(),
  latency_ms: z.number().nullable(),
  checked_at: z.string(),
});
