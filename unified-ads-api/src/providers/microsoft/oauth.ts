import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { MICROSOFT_SCOPE, object } from "./config.js";
import { ApiError } from "../../utils/errors.js";
import { responseBytes, type MicrosoftFetch } from "./client.js";

export const MICROSOFT_REDIRECT_URI = "http://localhost:8089/oauth/microsoft/callback";
export interface MicrosoftOAuthSession {
  clientId: string;
  tenant: string;
  redirectUri: string;
  state: string;
  verifier: string;
  createdAt: number;
}
export function createMicrosoftOAuthRequest(clientId: string, redirectUri = MICROSOFT_REDIRECT_URI, tenant = "common") {
  if (
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(clientId) ||
    !/^(?:common|organizations|consumers|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(tenant)
  )
    throw new ApiError("INVALID_REQUEST", "Revisa el Client ID y el tenant de Microsoft.");
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new ApiError("INVALID_REQUEST", "La URI OAuth de Microsoft no es válida.");
  }
  if (
    redirect.protocol !== "http:" ||
    redirect.hostname !== "localhost" ||
    !redirect.port ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "El asistente manual usa una URI HTTP de localhost con puerto y sin parámetros.",
    );
  const session: MicrosoftOAuthSession = {
    clientId,
    tenant,
    redirectUri,
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    createdAt: Date.now(),
  };
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_SCOPE,
    prompt: "consent",
    state: session.state,
    code_challenge: createHash("sha256").update(session.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { session, url: url.toString() };
}
export function microsoftAuthorizationCode(callback: string, session: MicrosoftOAuthSession): string {
  let url: URL;
  try {
    url = new URL(callback);
  } catch {
    throw new ApiError("INVALID_REQUEST", "Guarda la URL completa del retorno OAuth de Microsoft.");
  }
  const registered = new URL(session.redirectUri);
  if (Date.now() - session.createdAt > 20 * 60000 || session.createdAt > Date.now())
    throw new ApiError("AUTH_ERROR", "La sesión OAuth venció. Inicia una autorización nueva.");
  const actual = Buffer.from(url.searchParams.get("state") ?? ""),
    expected = Buffer.from(session.state);
  if (
    url.origin !== registered.origin ||
    url.pathname !== registered.pathname ||
    url.hash ||
    url.username ||
    url.password ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected) ||
    url.searchParams.getAll("state").length !== 1
  )
    throw new ApiError("AUTH_ERROR", "El retorno OAuth no corresponde a la sesión de Microsoft.");
  if (url.searchParams.has("error")) throw new ApiError("AUTH_ERROR", "Microsoft rechazó o canceló la autorización.");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.getAll("code").length !== 1)
    throw new ApiError("AUTH_ERROR", "Microsoft no devolvió un código de autorización único.");
  return code;
}
export async function exchangeMicrosoftCode(
  session: MicrosoftOAuthSession,
  clientSecret: string,
  callback: string,
  request: MicrosoftFetch = fetch,
): Promise<string> {
  const code = microsoftAuthorizationCode(callback, session),
    signal = AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await request(`https://login.microsoftonline.com/${session.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: session.clientId,
        client_secret: clientSecret,
        redirect_uri: session.redirectUri,
        grant_type: "authorization_code",
        scope: MICROSOFT_SCOPE,
        code,
        code_verifier: session.verifier,
      }),
    });
  } catch {
    throw new ApiError("PROVIDER_ERROR", "No se pudo completar OAuth con Microsoft.");
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await responseBytes(response, 1024 * 1024, signal)));
  } catch {
    throw new ApiError("PROVIDER_ERROR", "Microsoft devolvió una respuesta OAuth incompatible.");
  }
  if (
    !response.ok ||
    !object(body) ||
    typeof body.refresh_token !== "string" ||
    !body.refresh_token ||
    /[\r\n]/.test(body.refresh_token)
  )
    throw new ApiError(
      "AUTH_ERROR",
      "No se obtuvo el refresh token. Revisa el secreto, el callback Web y el consentimiento; si el código venció, vuelve a autorizar.",
    );
  return body.refresh_token;
}
