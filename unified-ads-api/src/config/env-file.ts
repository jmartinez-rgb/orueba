import { randomBytes } from "node:crypto";
import { chmod, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { updateEnvVariable } from "../providers/google/oauth.js";

/**
 * Actualiza variables de un archivo .env sin perder sus demás líneas. Solo acepta un archivo normal
 * (no enlaces), distingue "no existe" de cualquier otro fallo de lectura (que nunca se trata como
 * archivo vacío), escribe un temporal exclusivo 0600, lo sustituye de forma atómica y lo borra si
 * algo falla. Los mensajes de error nunca incluyen valores.
 */
export async function updateEnvFile(path: string, updates: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(updates))
    if (!value || /[\r\n]/.test(value)) throw new Error(`Valor inválido para ${name}.`);
  let content = "";
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`${path} debe ser un archivo normal.`);
    content = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  let next = content;
  for (const [name, value] of Object.entries(updates)) next = updateEnvVariable(next, name, value);
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, next, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
