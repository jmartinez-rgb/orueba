import { createSign } from "node:crypto";
import { ApiError } from "../../utils/errors.js";
import { GOOGLE_ADS_SCOPE, GOOGLE_TOKEN_URL, type GoogleConfig } from "./config.js";
import { googleError } from "./errors.js";
import type { GoogleFetch } from "./types.js";

export class GoogleAuthClient {
  private cached: { value: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly config: GoogleConfig,
    private readonly request: GoogleFetch = fetch,
  ) {}

  invalidate(token: string): void {
    if (this.cached?.value === token) this.cached = null;
  }

  async token(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (this.cached && this.cached.expiresAt > Date.now() + 30000) return this.cached.value;
    if (!this.pending)
      this.pending = this.exchange().finally(() => {
        this.pending = null;
      });
    const pending = this.pending;
    if (!signal) return pending;
    // Renovación compartida: cancelar un caller no corta a los demás; tiene su propio timeout.
    return new Promise<string>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private async exchange(): Promise<string> {
    const auth = this.config.auth;
    let body: URLSearchParams;
    if (auth.kind === "refresh_token") {
      body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        refresh_token: auth.refreshToken,
      });
    } else {
      const now = Math.floor(Date.now() / 1000);
      const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
      const claim = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
        iss: auth.email,
        scope: GOOGLE_ADS_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600,
        ...(auth.subject ? { sub: auth.subject } : {}),
      })}`;
      let signature: string;
      try {
        signature = createSign("RSA-SHA256").update(claim).sign(auth.privateKey, "base64url");
      } catch {
        throw new ApiError("NOT_CONFIGURED", "La llave de la cuenta de servicio de Google no es válida.");
      }
      body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${claim}.${signature}`,
      });
    }
    let response: Response;
    try {
      response = await this.request(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
        throw new ApiError("PROVIDER_TIMEOUT", "Google OAuth no respondió a tiempo.");
      throw new ApiError("PROVIDER_ERROR", "No se pudo conectar con Google OAuth.");
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) throw googleError(response.status, null, response.headers);
      throw new ApiError("PROVIDER_ERROR", "Google OAuth devolvió una respuesta inválida.");
    }
    if (!response.ok) throw googleError(response.status, data, response.headers);
    const token = data as { access_token?: unknown; expires_in?: unknown } | null;
    if (
      !token ||
      typeof token.access_token !== "string" ||
      !token.access_token ||
      typeof token.expires_in !== "number" ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    )
      throw new ApiError("PROVIDER_ERROR", "Google OAuth no devolvió un token válido con vencimiento.");
    this.cached = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
    return token.access_token;
  }
}
