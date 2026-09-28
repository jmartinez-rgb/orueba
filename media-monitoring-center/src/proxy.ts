import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthMode, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";

/**
 * Puerta de acceso: sin sesión válida, las páginas redirigen a /login y las API responden 401.
 * El servidor vuelve a validar la sesión en cada página y API (defensa en profundidad).
 */

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/health", "/api/monitoring/evaluate"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const mode = resolveAuthMode(process.env);
  if (mode === "open" || mode === "header") return NextResponse.next();

  const secret = process.env.AUTH_SECRET?.trim();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = mode === "password" && secret && token ? await verifySessionToken(token, secret) : null;
  if (valid) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, message: mode === "locked" ? "El acceso no está configurado." : "Tu sesión terminó. Vuelve a iniciar sesión." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|favicon.ico|robots.txt).*)"],
};
