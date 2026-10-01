import "dotenv/config";
import { readFile, writeFile, chmod, unlink, rename, lstat } from "node:fs/promises";
import {
  createSpotifyOAuthRequest,
  exchangeSpotifyCode,
  type SpotifyOAuthSession,
} from "../src/providers/spotify/oauth.js";
import { updateEnvVariable } from "../src/providers/google/oauth.js";
import { object } from "../src/providers/spotify/config.js";

/** Browser-only OAuth: read private inputs, print only a public authorization URL. */
async function main() {
  const path = ".spotify-oauth-session",
    mode = process.argv[2] ?? "--start";
  if (mode === "--start") {
    const clientId = process.env.SPOTIFY_ADS_CLIENT_ID?.trim();
    if (!clientId) throw new Error("Configura SPOTIFY_ADS_CLIENT_ID antes de iniciar OAuth.");
    const auth = createSpotifyOAuthRequest(clientId, process.env.SPOTIFY_ADS_REDIRECT_URI?.trim());
    await writeFile(path, JSON.stringify(auth.session), { mode: 0o600, flag: "wx" });
    process.stdout.write(
      `Registra esta URI en la app de Spotify: ${auth.session.redirectUri}\nAutoriza esta sesión:\n${auth.url}\n`,
    );
    process.stdout.write(
      "Después guarda la URL completa de retorno en SPOTIFY_ADS_AUTH_CALLBACK_URL privado y ejecuta spotify:auth -- --complete. La sesión dura 30 minutos; el código vence 10 minutos después de autorizar.\n",
    );
    return;
  }
  if (mode === "--cancel") {
    await unlink(path).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
    process.stdout.write("Sesión OAuth de Spotify cancelada.\n");
    return;
  }
  if (mode !== "--complete") throw new Error("Usa --start, --complete o --cancel.");
  const secret = process.env.SPOTIFY_ADS_CLIENT_SECRET?.trim(),
    callback = process.env.SPOTIFY_ADS_AUTH_CALLBACK_URL?.trim();
  if (!secret || !callback)
    throw new Error(
      "Completar OAuth requiere SPOTIFY_ADS_CLIENT_SECRET y SPOTIFY_ADS_AUTH_CALLBACK_URL en variables privadas.",
    );
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Sesión OAuth inválida.");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !object(value) ||
    !["clientId", "redirectUri", "state"].every((k) => typeof value[k] === "string") ||
    typeof value.createdAt !== "number"
  )
    throw new Error("Sesión OAuth inválida.");
  const session = value as unknown as SpotifyOAuthSession;
  if (process.env.SPOTIFY_ADS_CLIENT_ID?.trim() && process.env.SPOTIFY_ADS_CLIENT_ID.trim() !== session.clientId)
    throw new Error("El Client ID de Spotify cambió desde el inicio de OAuth.");
  const token = await exchangeSpotifyCode(session, secret, callback);
  let content = "";
  try {
    const envInfo = await lstat(".env");
    if (!envInfo.isFile()) throw new Error(".env debe ser un archivo normal.");
    content = await readFile(".env", "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const temporary = `.env.spotify-${process.pid}`;
  try {
    await writeFile(temporary, updateEnvVariable(content, "SPOTIFY_ADS_REFRESH_TOKEN", token), {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporary, 0o600);
    await rename(temporary, ".env");
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  await unlink(path);
  process.stdout.write(
    "SPOTIFY_ADS_REFRESH_TOKEN guardado en .env privado (0600). Reinicia solo el servicio para cargarlo.\n",
  );
}
void main().catch((e: unknown) => {
  const message =
    e instanceof Error &&
    (e.name === "ApiError" ||
      e.message.startsWith("Configura") ||
      e.message.startsWith("Completar OAuth") ||
      e.message.startsWith("Usa --"))
      ? e.message
      : "No se pudo completar el asistente de Spotify. Revisa las variables privadas; cancela e inicia una sesión nueva si venció.";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
