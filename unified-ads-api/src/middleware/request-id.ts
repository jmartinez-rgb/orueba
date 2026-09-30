import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const REQUEST_ID_HEADER = "x-request-id";
const VALID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Usa el X-Request-Id que llega (si es válido) para seguir una solicitud entre n8n y la API; si no, genera uno. */
export function genRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && VALID.test(value) ? value : randomUUID();
}
