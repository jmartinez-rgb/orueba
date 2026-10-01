import { ApiError } from "../../utils/errors.js";
import { TIKTOK_BASE_URL, TIKTOK_API_VERSION, tiktokId } from "./config.js";
import { tiktokError } from "./errors.js";
import { tiktokObject, type TikTokFetch } from "./types.js";

/**
 * Autorización de cuentas publicitarias de TikTok (contrato v1.3 del SDK oficial): la persona abre
 * el enlace de autorización de la app, TikTok regresa a la URL de retorno con `auth_code` y ese
 * código se canjea una sola vez por el token de acceso (POST oauth2/access_token con app_id, secret
 * y auth_code). Nunca se registra la URL de retorno, el código ni el token.
 */

/** Acepta la URL completa de retorno o solo el código. */
export function tiktokAuthCode(input: string): string {
  const value = input.trim();
  let code: string | null = value;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ApiError("INVALID_REQUEST", "La URL de retorno de TikTok no es válida.");
    }
    if (url.searchParams.get("error") || url.searchParams.get("error_code"))
      throw new ApiError("ACCESS_DENIED", "La autorización de TikTok se canceló o fue rechazada.");
    code = url.searchParams.get("auth_code") ?? url.searchParams.get("code");
  }
  if (!code || !/^[\w.-]{8,1024}$/.test(code))
    throw new ApiError("INVALID_REQUEST", "No se encontró un auth_code válido en la URL de retorno de TikTok.");
  return code;
}

export interface TikTokAuthorization {
  accessToken: string;
  /** Cuentas publicitarias autorizadas (IDs en texto). */
  advertiserIds: string[];
  scope: number[];
}

export async function exchangeTikTokCode(
  opts: { appId: string; secret: string; authCode: string },
  request: TikTokFetch = fetch,
): Promise<TikTokAuthorization> {
  let response: Response;
  try {
    response = await request(`${TIKTOK_BASE_URL}/open_api/${TIKTOK_API_VERSION}/oauth2/access_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: opts.appId, secret: opts.secret, auth_code: opts.authCode }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError("PROVIDER_ERROR", "No se pudo conectar con TikTok para canjear la autorización.");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("PROVIDER_ERROR", "TikTok devolvió una respuesta inválida al canjear la autorización.");
  }
  if (!response.ok || !tiktokObject(body) || body.code !== 0) {
    const err = tiktokError(response.status, body, response.headers);
    // Un auth_code vencido o ya usado llega como parámetro inválido: se explica sin repetir el código.
    throw err.code === "INVALID_REQUEST"
      ? new ApiError(
          "INVALID_REQUEST",
          "TikTok rechazó el código: vence en minutos y solo se puede usar una vez. Autoriza de nuevo.",
          { details: err.details },
        )
      : err;
  }
  const data = tiktokObject(body.data) ? body.data : {};
  if (typeof data.access_token !== "string" || !data.access_token || /[\r\n]/.test(data.access_token))
    throw new ApiError("PROVIDER_ERROR", "TikTok no devolvió un token de acceso válido.");
  const ids = Array.isArray(data.advertiser_ids) ? data.advertiser_ids : [];
  const advertiserIds = ids.flatMap((id) => {
    const text = typeof id === "number" && Number.isSafeInteger(id) ? String(id) : id;
    try {
      return [tiktokId(text as string)];
    } catch {
      return [];
    }
  });
  const scope = Array.isArray(data.scope) ? data.scope.filter((s): s is number => typeof s === "number") : [];
  return { accessToken: data.access_token, advertiserIds: [...new Set(advertiserIds)], scope };
}
