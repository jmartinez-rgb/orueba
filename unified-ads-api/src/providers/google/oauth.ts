import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { GOOGLE_ADS_SCOPE, GOOGLE_TOKEN_URL } from "./config.js";
import { ApiError } from "../../utils/errors.js";
import { googleError } from "./errors.js";
import type { GoogleFetch } from "./types.js";

export function createOAuthRequest(clientId: string, redirectUri: string) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_ADS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state, verifier };
}

export function validOAuthState(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const OAUTH_HINTS: Record<string, [ApiError["code"], string]> = {
  invalid_client: [
    "AUTH_ERROR",
    "Google rechazó el ID o el secreto del cliente. Revisa que GOOGLE_ADS_CLIENT_SECRET sea del mismo ID de cliente que GOOGLE_ADS_CLIENT_ID, sin espacios ni comillas; si acabas de crear el secreto, espera unos minutos y repite",
  ],
  invalid_grant: [
    "AUTH_ERROR",
    "El código de autorización ya no es válido (vencido o usado). Vuelve a correr npm run google:auth y autoriza enseguida con la liga nueva",
  ],
  redirect_uri_mismatch: [
    "INVALID_REQUEST",
    "La URI de redireccionamiento no coincide con la registrada en el ID de cliente. Agrega exactamente http://127.0.0.1:8089/oauth/google/callback",
  ],
  unauthorized_client: [
    "AUTH_ERROR",
    "Este ID de cliente no puede usar este tipo de autorización. Usa un cliente de tipo Aplicación web o App de escritorio",
  ],
};

export async function exchangeAuthorizationCode(
  opts: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    verifier: string;
  },
  request: GoogleFetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await request(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: opts.code,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: opts.redirectUri,
        code_verifier: opts.verifier,
      }),
    });
  } catch {
    throw new ApiError("PROVIDER_ERROR", "No se pudo conectar con Google OAuth.");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("PROVIDER_ERROR", "Google OAuth devolvió una respuesta inválida.");
  }
  if (!response.ok) {
    // El código de error OAuth es público (RFC 6749) y no contiene secretos; se informa para saber qué corregir.
    const raw = (data as { error?: unknown } | null)?.error;
    const code = typeof raw === "string" && /^[a-z_]{1,64}$/.test(raw) ? raw : null;
    const hint = code ? OAUTH_HINTS[code] : undefined;
    if (hint)
      throw new ApiError(hint[0], `${hint[1]} (${code})`, { details: { provider: "google", oauth_error: code } });
    throw googleError(response.status, data, response.headers);
  }
  const token = (data as { refresh_token?: unknown } | null)?.refresh_token;
  if (typeof token !== "string" || !token)
    throw new ApiError("AUTH_ERROR", "Google no devolvió un refresh token. Repite la autorización con consentimiento.");
  return token;
}

/** Reemplaza únicamente una variable; mantiene comentarios y las demás configuraciones. */
export function updateEnvVariable(content: string, name: string, value: string): string {
  if (!/^[A-Z_][A-Z_0-9]*$/.test(name)) throw new Error("Nombre de variable inválido.");
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, "gm");
  if (pattern.test(content)) return content.replace(pattern, () => line);
  return `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
}
