import "dotenv/config";
import { createServer } from "node:http";
import { readFile, writeFile, chmod } from "node:fs/promises";
import {
  createOAuthRequest,
  validOAuthState,
  exchangeAuthorizationCode,
  updateEnvVariable,
} from "../src/providers/google/oauth.js";

/** Asistente local: el navegador autoriza; los tokens solo se guardan en .env (0600). */
async function main() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret)
    throw new Error("Configura GOOGLE_ADS_CLIENT_ID y GOOGLE_ADS_CLIENT_SECRET en .env antes de autorizar.");
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI?.trim() ?? "http://127.0.0.1:8089/oauth/google/callback";
  const redirect = new URL(redirectUri);
  if (
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    !redirect.port ||
    redirect.search ||
    redirect.hash
  )
    throw new Error(
      "GOOGLE_ADS_REDIRECT_URI debe ser HTTP en 127.0.0.1, con puerto explícito y sin query ni fragmento.",
    );
  const auth = createOAuthRequest(clientId, redirectUri);
  let completing = false;
  let timer: NodeJS.Timeout;
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(Number(redirect.port), "127.0.0.1", resolve);
  });
  process.stdout.write(
    `Autoriza en tu navegador (registra este callback en Google Cloud: ${redirectUri}):\n${auth.url}\n`,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("La autorización venció después de 5 minutos.")), 300000);
      server.on("request", (req, res) => {
        void (async () => {
          const url = new URL(req.url ?? "/", redirect.origin);
          if (req.method !== "GET" || url.pathname !== redirect.pathname) {
            res.writeHead(404);
            res.end();
            return;
          }
          if (!validOAuthState(url.searchParams.get("state"), auth.state)) {
            res.writeHead(400);
            res.end("Estado de autorización inválido.");
            return;
          }
          if (completing) {
            res.writeHead(409);
            res.end("La autorización ya se está completando.");
            return;
          }
          completing = true;
          res.setHeader("cache-control", "no-store");
          res.setHeader("content-type", "text/plain; charset=utf-8");
          try {
            if (url.searchParams.has("error")) throw new Error("Google rechazó o canceló la autorización.");
            const code = url.searchParams.get("code");
            if (!code) throw new Error("Google no devolvió un código de autorización.");
            const token = await exchangeAuthorizationCode({
              clientId,
              clientSecret,
              code,
              redirectUri,
              verifier: auth.verifier,
            });
            let content = "";
            try {
              content = await readFile(".env", "utf8");
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
            }
            await writeFile(".env", updateEnvVariable(content, "GOOGLE_ADS_REFRESH_TOKEN", token), { mode: 0o600 });
            await chmod(".env", 0o600);
            res.end("Autorización completada. El refresh token quedó guardado localmente. Puedes cerrar esta pestaña.");
            resolve();
          } catch (err) {
            res.writeHead(500);
            res.end("No se pudo completar la autorización. Revisa la terminal.");
            reject(err);
          }
        })().catch(reject);
      });
    });
    process.stdout.write("GOOGLE_ADS_REFRESH_TOKEN guardado en .env con permisos 0600. No se imprimieron tokens.\n");
  } finally {
    clearTimeout(timer!);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : "No se pudo autorizar Google Ads."}\n`);
  process.exitCode = 1;
});
