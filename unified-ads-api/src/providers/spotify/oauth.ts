import { randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "../../utils/errors.js";
import { object } from "./config.js";
import { spotifyBasic, spotifyJson, SPOTIFY_TOKEN_URL, type SpotifyFetch } from "./client.js";

export const SPOTIFY_REDIRECT = "http://127.0.0.1:8089/oauth/spotify/callback";
// The code's ten-minute lifetime starts when Spotify issues it, not when this link is created.
// Keep a bounded CSRF-state window that also accommodates browser interaction and cloud publication.
export const SPOTIFY_SESSION_TTL_MS = 30 * 60000;
export interface SpotifyOAuthSession {
  clientId: string;
  redirectUri: string;
  state: string;
  createdAt: number;
}
export function createSpotifyOAuthRequest(clientId: string, redirectUri = SPOTIFY_REDIRECT) {
  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    throw new ApiError("INVALID_REQUEST", "La URI de retorno de Spotify no es válida.");
  }
  if (
    !/^[A-Za-z\d_-]{1,128}$/.test(clientId) ||
    callback.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(callback.hostname) ||
    !callback.port ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "Spotify requiere un Client ID válido y callback HTTP con IP de loopback y puerto; localhost no está permitido.",
    );
  const state = randomBytes(32).toString("base64url");
  const session: SpotifyOAuthSession = { clientId, redirectUri: callback.toString(), state, createdAt: Date.now() };
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: session.redirectUri,
    state,
    show_dialog: "true",
  }).toString();
  // Ads API's official confidential-client flow requests no Web API/music scopes.
  return { session, url: url.toString() };
}
export function spotifyAuthorizationCode(value: string, session: SpotifyOAuthSession, now = Date.now()) {
  if (
    !Number.isFinite(session.createdAt) ||
    session.createdAt > now ||
    now - session.createdAt >= SPOTIFY_SESSION_TTL_MS
  )
    throw new ApiError("AUTH_ERROR", "La sesión de Spotify venció. Inicia una autorización nueva.");
  let callback: URL, expected: URL;
  try {
    if (value.length > 32768) throw new Error();
    callback = new URL(value);
    expected = new URL(session.redirectUri);
  } catch {
    throw new ApiError("AUTH_ERROR", "La URL de retorno de Spotify no es válida.");
  }
  if (
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.searchParams.getAll("state").length !== 1
  )
    throw new ApiError("AUTH_ERROR", "El retorno de Spotify no corresponde a esta sesión.");
  const received = Buffer.from(callback.searchParams.get("state") ?? ""),
    saved = Buffer.from(session.state);
  if (received.length !== saved.length || !timingSafeEqual(received, saved))
    throw new ApiError("AUTH_ERROR", "El estado OAuth de Spotify no corresponde a esta sesión.");
  if (callback.searchParams.has("error"))
    throw new ApiError("AUTH_ERROR", "Spotify no autorizó la app. Inicia una autorización nueva.");
  const code = callback.searchParams.get("code");
  if (callback.searchParams.getAll("code").length !== 1 || !code || code.length > 16384 || /[\r\n]/.test(code))
    throw new ApiError("AUTH_ERROR", "El retorno de Spotify no contiene un código válido.");
  return code;
}
export async function exchangeSpotifyCode(
  session: SpotifyOAuthSession,
  secret: string,
  callback: string,
  request: SpotifyFetch = fetch,
) {
  createSpotifyOAuthRequest(session.clientId, session.redirectUri);
  if (!secret.trim() || /[\r\n]/.test(secret))
    throw new ApiError("AUTH_ERROR", "Configura el Client Secret privado de Spotify.");
  const code = spotifyAuthorizationCode(callback, session),
    signal = AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await request(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: spotifyBasic(session.clientId, secret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: session.redirectUri,
      }).toString(),
      signal,
      redirect: "error",
    });
  } catch {
    throw new ApiError("PROVIDER_ERROR", "No se pudo completar OAuth con Spotify.");
  }
  const data = await spotifyJson(response, signal);
  if (!response.ok || !object(data) || typeof data.error === "string") {
    const error =
      object(data) &&
      typeof data.error === "string" &&
      ["invalid_client", "invalid_grant", "invalid_request", "unsupported_grant_type"].includes(data.error)
        ? data.error
        : "unknown";
    throw new ApiError(
      "AUTH_ERROR",
      "Spotify no pudo canjear el código. Revisa el secreto privado, el callback y la vigencia de la sesión.",
      { details: { provider: "spotify", oauth_error: error } },
    );
  }
  if (
    typeof data.refresh_token !== "string" ||
    !data.refresh_token ||
    /[\r\n]/.test(data.refresh_token) ||
    typeof data.access_token !== "string" ||
    !data.access_token ||
    /[\r\n]/.test(data.access_token) ||
    String(data.token_type).toLowerCase() !== "bearer"
  )
    throw new ApiError("PROVIDER_ERROR", "Spotify no devolvió un refresh token válido.");
  return data.refresh_token;
}
