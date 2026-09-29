/**
 * Token de sesión firmado (HMAC-SHA256 con AUTH_SECRET). Usa solo Web Crypto para que
 * funcione igual en el proxy (runtime de borde de Netlify) y en las funciones del servidor.
 * El token no contiene secretos: usuario, nombre visible, rol y vencimiento.
 */
import { isRole, type Role } from "./roles";

export const SESSION_COOKIE = "immc_session";

export type AuthMode = "password" | "open" | "header" | "locked";

export type UserKind = "named" | "universal";

export interface SessionClaims {
  /** Identificador estable: usuario de la cuenta o "invitado:<nombre-normalizado>". */
  sub: string;
  name: string;
  role: Role;
  kind: UserKind;
  /** Identificador de la sesión (para la bitácora). */
  sid: string;
  /** Emitido y vence (segundos epoch). */
  iat: number;
  exp: number;
  /**
   * Versión de la cuenta al iniciar sesión. Cambiar la contraseña o desactivar la cuenta sube
   * la versión y cierra sus sesiones abiertas.
   */
  v?: number;
}

interface EnvLike {
  [key: string]: string | undefined;
}

/** Longitud mínima de AUTH_SECRET para considerarlo válido. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Modo de acceso efectivo a partir de las variables de entorno. Compartido por el proxy y el servidor.
 * - AUTH_MODE=header → identidad por cabeceras de un proxy/SSO de confianza.
 * - AUTH_MODE=open → sin contraseña (demo local).
 * - Con AUTH_SECRET y al menos una credencial → contraseña.
 * - Sin configuración: abierto en desarrollo local; bloqueado en producción.
 * El valor antiguo AUTH_MODE=dev (de la primera versión) cuenta como automático: nunca apaga
 * las contraseñas ya configuradas ni abre un despliegue de producción.
 */
export function resolveAuthMode(env: EnvLike): AuthMode {
  const mode = (env.AUTH_MODE ?? "").trim().toLowerCase();
  if (mode === "header") return "header";
  if (mode === "open") return "open";
  const secret = (env.AUTH_SECRET ?? "").trim();
  const hasCredentials = Boolean((env.AUTH_USERS ?? "").trim() || (env.AUTH_UNIVERSAL_PASSWORD_HASH ?? "").trim());
  if (secret.length >= MIN_SECRET_LENGTH && hasCredentials) return "password";
  if (mode === "password") return "locked";
  return env.NODE_ENV === "production" ? "locked" : "open";
}

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function signSessionToken(claims: SessionClaims, secret: string): Promise<string> {
  const payload = b64urlEncode(encoder.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`v1.${payload}`)));
  return `v1.${payload}.${b64urlEncode(sig)}`;
}

/** Devuelve las claims si la firma es válida y no ha vencido; si no, null. */
export async function verifySessionToken(token: string, secret: string, nowMs = Date.now()): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const sig = b64urlDecode(parts[2]);
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig as BufferSource, encoder.encode(`v1.${parts[1]}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as Partial<SessionClaims>;
    if (typeof claims.sub !== "string" || typeof claims.name !== "string" || !isRole(claims.role)) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) return null;
    if (claims.kind !== "named" && claims.kind !== "universal") return null;
    return claims as SessionClaims;
  } catch {
    return null;
  }
}

export function randomId(bytes = 12): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64urlEncode(b);
}
