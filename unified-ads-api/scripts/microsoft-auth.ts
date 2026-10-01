import "dotenv/config";
import { updateEnvFile } from "../src/config/env-file.js";
import { readFile, writeFile, unlink, lstat } from "node:fs/promises";
import {
  createMicrosoftOAuthRequest,
  exchangeMicrosoftCode,
  type MicrosoftOAuthSession,
} from "../src/providers/microsoft/oauth.js";
import { object } from "../src/providers/microsoft/config.js";

/** Browser-only onboarding: never print secrets, tokens, authorization codes, or callback URLs. */
async function main() {
  const path = ".microsoft-oauth-session";
  const mode = process.argv[2] ?? "--start";
  if (mode === "--start") {
    const clientId = process.env.MICROSOFT_ADS_CLIENT_ID?.trim();
    if (!clientId) throw new Error("Configura MICROSOFT_ADS_CLIENT_ID antes de iniciar OAuth.");
    const auth = createMicrosoftOAuthRequest(
      clientId,
      process.env.MICROSOFT_ADS_REDIRECT_URI?.trim(),
      process.env.MICROSOFT_ADS_TENANT?.trim(),
    );
    // wx refuses to follow a symlink or overwrite an existing in-progress session.
    await writeFile(path, JSON.stringify(auth.session), { mode: 0o600, flag: "wx" });
    process.stdout.write(
      `Registra la URI de redirección como plataforma Web: ${auth.session.redirectUri}\nAutoriza esta sesión:\n${auth.url}\n`,
    );
    process.stdout.write(
      "Después guarda la URL completa de retorno en la variable privada MICROSOFT_ADS_AUTH_CALLBACK_URL y ejecuta microsoft:auth -- --complete.\n",
    );
    return;
  }
  if (mode === "--cancel") {
    await unlink(path).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
    process.stdout.write("Sesión OAuth cancelada. Puedes iniciar una nueva.\n");
    return;
  }
  if (mode !== "--complete") throw new Error("Usa --start, --complete o --cancel.");
  const secret = process.env.MICROSOFT_ADS_CLIENT_SECRET?.trim();
  const callback = process.env.MICROSOFT_ADS_AUTH_CALLBACK_URL?.trim();
  if (!secret || !callback)
    throw new Error(
      "Completar OAuth requiere MICROSOFT_ADS_CLIENT_SECRET y MICROSOFT_ADS_AUTH_CALLBACK_URL en variables privadas.",
    );
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error("La sesión OAuth debe ser un archivo privado con permisos 0600.");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !object(value) ||
    !["clientId", "tenant", "redirectUri", "state", "verifier"].every((k) => typeof value[k] === "string") ||
    typeof value.createdAt !== "number"
  )
    throw new Error("La sesión OAuth no es válida. Cancela e inicia una nueva.");
  const session = value as unknown as MicrosoftOAuthSession;
  if (process.env.MICROSOFT_ADS_CLIENT_ID?.trim() && process.env.MICROSOFT_ADS_CLIENT_ID.trim() !== session.clientId)
    throw new Error("El Client ID cambió desde el inicio de OAuth. Inicia una nueva sesión.");
  createMicrosoftOAuthRequest(session.clientId, session.redirectUri, session.tenant); // Revalidate fixed token host and callback.
  const refresh = await exchangeMicrosoftCode(session, secret, callback);
  await updateEnvFile(".env", { MICROSOFT_ADS_REFRESH_TOKEN: refresh });
  await unlink(path);
  process.stdout.write(
    "MICROSOFT_ADS_REFRESH_TOKEN guardado en .env privado (0600). No se imprimieron tokens. Reinicia solo el servicio para cargarlo.\n",
  );
}
void main().catch((err: unknown) => {
  // Parsing and filesystem errors can contain callback data; keep output independent of their values.
  const message =
    err instanceof Error &&
    (err.name === "ApiError" ||
      err.message.startsWith("Configura") ||
      err.message.startsWith("Completar OAuth") ||
      err.message.startsWith("Usa --"))
      ? err.message
      : "No se pudo completar el asistente. Revisa las variables privadas y cancela una sesión anterior antes de empezar otra.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
