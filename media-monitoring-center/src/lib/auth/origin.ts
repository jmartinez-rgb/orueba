/**
 * Defensa CSRF de las API que mutan (la usa el proxy). Además de SameSite=Lax, solo se aceptan
 * peticiones del mismo origen: un sitio hermano del mismo dominio (same-site) también envía
 * cookies Lax. Los clientes sin navegador no envían Origin ni Sec-Fetch-Site y tampoco portan la
 * cookie de otra persona; siguen sujetos a la sesión y a los permisos de cada ruta.
 */

export interface OriginCheckRequest {
  method: string;
  pathname: string;
  headers: Pick<Headers, "get">;
  /** Host de la URL que recibió el servidor (respaldo si faltan Host y X-Forwarded-Host). */
  host: string;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Servidor a servidor con MONITORING_API_KEY: no usa la cookie de sesión. */
const SERVER_TO_SERVER = new Set(["/api/monitoring/evaluate"]);

export function isCrossOriginMutation(req: OriginCheckRequest): boolean {
  if (!MUTATING_METHODS.has(req.method.toUpperCase()) || !req.pathname.startsWith("/api/") || SERVER_TO_SERVER.has(req.pathname)) return false;
  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin")?.trim();
  if (!origin) return false;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.host).split(",")[0].trim().toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() !== host;
  } catch {
    // "null" (iframes con sandbox, redirecciones opacas) u orígenes ilegibles.
    return true;
  }
}
