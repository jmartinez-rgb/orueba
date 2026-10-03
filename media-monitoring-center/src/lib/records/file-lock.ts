import "server-only";
import { constants } from "node:fs";
import { link, open, rename, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Lock entre procesos del mismo host para una llave del backend File (`<archivo>.lock`).
 * El contenido se escribe en un temporal y se publica con `link`, que falla si el lock existe:
 * nunca hay un lock a medio escribir. Un lock es abandonado cuando su proceso ya no existe en
 * este host, cuando pertenece a una ejecución anterior de este mismo PID o cuando supera
 * `FILE_LOCK_STALE_MS`. No coordina instancias que compartan un volumen de red: el volumen
 * sigue requiriendo un único servidor.
 */
export const FILE_LOCK_STALE_MS = 120_000;
const WAIT_MS = 15_000;

interface Owner { pid: number; host: string; nonce: string; at: string }
interface Found { owner: Owner | null; ino: number; mtimeMs: number }

const held = new Set<string>();
const errno = (error: unknown) => error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function parseOwner(text: string): Owner | null {
  try {
    const value = JSON.parse(text) as Partial<Owner> | null;
    return value && Number.isSafeInteger(value.pid) && typeof value.host === "string" && typeof value.nonce === "string" && typeof value.at === "string" ? value as Owner : null;
  } catch { return null; }
}

async function inspect(file: string): Promise<Found | null> {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (errno(error) === "ENOENT") return null; throw error; }
  try {
    const info = await handle.stat();
    return { owner: parseOwner(await handle.readFile("utf8")), ino: info.ino, mtimeMs: info.mtimeMs };
  } finally { await handle.close(); }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return errno(error) === "EPERM"; }
}

function abandoned(found: Found, now = Date.now()): boolean {
  if (now - found.mtimeMs > FILE_LOCK_STALE_MS) return true;
  const owner = found.owner;
  if (!owner || owner.host !== hostname()) return false;
  if (owner.pid === process.pid) return !held.has(owner.nonce);
  return !alive(owner.pid);
}

/** Aparta el lock abandonado; si otro proceso ya lo había renovado, intenta devolverlo. */
async function release(file: string, found: Found) {
  const aside = `${file}.${randomUUID()}.stale`;
  try { await rename(file, aside); }
  catch (error) { if (errno(error) === "ENOENT") return; throw error; }
  try {
    const moved = await inspect(aside);
    if (moved && moved.ino !== found.ino) await link(aside, file).catch(() => undefined);
  } finally { await rm(aside, { force: true }); }
}

/**
 * Ejecuta `write` con el lock tomado. `stillHeld` permite confirmar, justo antes de publicar,
 * que el lock no fue considerado abandonado mientras se trabajaba.
 */
export async function withFileLock<T>(file: string, write: (stillHeld: () => Promise<boolean>) => Promise<T>, waitMs = WAIT_MS): Promise<T> {
  const nonce = randomUUID();
  const temp = `${file}.${nonce}.lock-tmp`;
  const deadline = Date.now() + waitMs;
  const draft = await open(temp, "wx", 0o600);
  try { await draft.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), nonce, at: new Date().toISOString() }), "utf8"); }
  finally { await draft.close(); }
  try {
    for (let attempt = 0; ; attempt++) {
      try { await link(temp, file); break; }
      catch (error) { if (errno(error) !== "EEXIST") throw error; }
      const found = await inspect(file);
      if (found && abandoned(found)) { await release(file, found); continue; }
      if (Date.now() > deadline) throw new Error("FILE_LOCK_TIMEOUT");
      await sleep(Math.min(2 ** Math.min(attempt, 6), 50) * (0.5 + Math.random()));
    }
  } finally { await rm(temp, { force: true }); }
  held.add(nonce);
  try {
    return await write(async () => (await inspect(file))?.owner?.nonce === nonce);
  } finally {
    held.delete(nonce);
    const found = await inspect(file).catch(() => null);
    if (found?.owner?.nonce === nonce) await rm(file, { force: true }).catch(() => undefined);
  }
}
