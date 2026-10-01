import "dotenv/config";
import { updateEnvFile } from "../src/config/env-file.js";
import { createInterface } from "node:readline/promises";
import { exchangeTikTokCode, tiktokAuthCode } from "../src/providers/tiktok/oauth.js";

/**
 * Canjea la autorización de TikTok por TIKTOK_ACCESS_TOKEN y lo guarda en .env (0600) sin
 * mostrarlo. La URL de retorno se lee de TIKTOK_AUTH_CALLBACK_URL (variable privada) o se pega en
 * esta terminal; nunca se comparte por chat. Uso: npm run tiktok:auth
 */
async function main() {
  const appId = process.env.TIKTOK_APP_ID?.trim(),
    secret = process.env.TIKTOK_APP_SECRET?.trim();
  if (!appId || !secret)
    throw new Error("Configura TIKTOK_APP_ID y TIKTOK_APP_SECRET antes de canjear la autorización.");
  let callback = process.env.TIKTOK_AUTH_CALLBACK_URL?.trim();
  if (!callback) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    callback = (await rl.question("Pega la URL completa a la que te regresó TikTok después de autorizar: ")).trim();
    rl.close();
  }
  const auth = await exchangeTikTokCode({ appId, secret, authCode: tiktokAuthCode(callback) });
  const updates: Record<string, string> = { TIKTOK_ACCESS_TOKEN: auth.accessToken };
  // Las cuentas autorizadas se guardan solo si aún no hay una lista elegida.
  if (auth.advertiserIds.length && !process.env.TIKTOK_ADVERTISER_IDS?.trim())
    updates.TIKTOK_ADVERTISER_IDS = auth.advertiserIds.join(",");
  await updateEnvFile(".env", updates);
  process.stdout.write(
    `TIKTOK_ACCESS_TOKEN guardado en .env privado (0600); no se mostró. Cuentas autorizadas (${auth.advertiserIds.length}): ${auth.advertiserIds.join(", ") || "ninguna"}.\n`,
  );
}

void main().catch((e: unknown) => {
  const message =
    e instanceof Error && (e.name === "ApiError" || e.message.startsWith("Configura"))
      ? e.message
      : "No se pudo completar la autorización de TikTok. Revisa App ID y App Secret y vuelve a autorizar.";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
