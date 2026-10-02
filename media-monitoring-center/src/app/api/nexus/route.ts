import { getSession, hasPermission } from "@/lib/auth/session";
import { isInternalRole } from "@/lib/auth/roles";
import { isBrand } from "@/lib/brands";
import { getSnapshot } from "@/lib/services/snapshot";
import { badRequest, forbidden, json, unauthorized } from "@/lib/services/http";
import { answerNexus } from "@/lib/nexus/answer";
import { projectNexusData } from "@/lib/nexus/data";
import { NexusRateLimit } from "@/lib/nexus/rate-limit";

export const dynamic = "force-dynamic";
const limiter = new NexusRateLimit();

/** Bound bytes before parsing; neither questions nor conversation history enter server logs. */
async function input(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("input");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4_096) { await reader.cancel(); throw new Error("input"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.authenticated) return unauthorized();
  if (!isInternalRole(session.role) || !hasPermission(session, "internal:view")) return forbidden("Nexus está disponible para el equipo con acceso al monitoreo interno.");
  let body: unknown;
  try { body = await input(request); } catch { return badRequest("Envía una pregunta de hasta 500 caracteres y la marca seleccionada."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("La consulta no es válida.");
  const { question, brand } = body as Record<string, unknown>;
  if (typeof question !== "string" || !question.trim() || question.length > 500 || !isBrand(brand)) return badRequest("Envía una pregunta de hasta 500 caracteres y la marca seleccionada.");
  if (session.brands.length && !session.brands.includes(brand)) return forbidden("No tienes acceso a esa marca.");
  const rate = limiter.take(session.user.id);
  if (!rate.allowed) return new Response(JSON.stringify({ ok: false, message: "Has enviado varias consultas seguidas. Espera un momento y vuelve a intentarlo." }), {
    status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "Retry-After": String(rate.retryAfter) },
  });
  try {
    const snapshot = await getSnapshot();
    // A tab may still display the old brand after another tab changed the shared cookie.
    if (snapshot.meta.brand.id !== brand) return json({ ok: false, message: "La marca seleccionada cambió. Actualiza la página antes de consultar Nexus." }, 409);
    return json({ ok: true, answer: answerNexus(question, projectNexusData(snapshot)) });
  } catch {
    // No technical errors, secret-bearing URLs, underlying notes or raw snapshots are returned.
    return json({ ok: false, message: "No pude consultar los datos del monitoreo. Intenta otra vez o revisa Integraciones." }, 503);
  }
}
