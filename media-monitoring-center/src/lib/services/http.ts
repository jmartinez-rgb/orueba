import "server-only";
import { NextResponse } from "next/server";
import { friendlyError, logger, type IntegrationTarget } from "@/lib/logging/logger";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function unauthorized(message = "Tu sesión terminó. Vuelve a iniciar sesión.") {
  return json({ ok: false, message }, 401);
}

export function forbidden(message = "Tu rol no tiene permiso para esta acción.") {
  return json({ ok: false, message }, 403);
}

export function badRequest(message: string) {
  return json({ ok: false, message }, 400);
}

export function notFound(message = "No se encontró.") {
  return json({ ok: false, message }, 404);
}

/** Error amigable para el usuario; el detalle técnico solo va al log (y a admins si se pide). */
export function serverError(target: IntegrationTarget, err: unknown, route: string) {
  const f = friendlyError(target, err);
  logger.error("api.error", { route, error: err });
  return json({ ok: false, message: f.message, technical: f.technical }, 500);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
