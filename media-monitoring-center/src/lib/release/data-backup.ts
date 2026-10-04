import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Consistent copy of the private data directories (records and direct-API history) with a SHA-256
 * manifest. It never follows symlinks, never overwrites, writes 0600 files under 0700 directories
 * and prints no file names or contents. Run it with the extractor and server stopped: File
 * coordination is per host and a copy during writes is not a snapshot.
 */
export class BackupError extends Error {
  constructor(readonly code: string) { super(`Respaldo no disponible (${code}).`); this.name = "BackupError"; }
}
export interface BackupSource { label: "records" | "unified"; directory: string }
export interface ManifestFile { path: string; size: number; sha256: string }
export interface BackupManifest { version: 1; origin: "MONITOR_DATA_BACKUP"; createdAt: string; sources: Array<{ label: BackupSource["label"]; files: ManifestFile[] }> }
export interface BackupSummary { files: number; bytes: number; skippedSymlinks: number; manifest: string }

const MANIFEST = "manifest.json";
const LABEL = /^(records|unified)$/;
// In-flight write artifacts of the File backend: their presence means a writer is active.
const IN_FLIGHT = /\.(?:lock|tmp|lock-tmp|stale)$/;
const errno = (error: unknown) => (error && typeof error === "object" && "code" in error ? String(error.code) : "");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function walk(root: string, rel = ""): Promise<{ files: string[]; symlinks: number; inFlight: number }> {
  const out = { files: [] as string[], symlinks: 0, inFlight: 0 };
  let entries;
  try { entries = await readdir(path.join(root, rel), { withFileTypes: true }); }
  catch (error) { if (errno(error) === "ENOENT" && !rel) return out; throw new BackupError("SOURCE_UNREADABLE"); }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) { out.symlinks++; continue; }
    if (entry.isDirectory()) { const sub = await walk(root, child); out.files.push(...sub.files); out.symlinks += sub.symlinks; out.inFlight += sub.inFlight; continue; }
    if (!entry.isFile()) continue;
    if (IN_FLIGHT.test(entry.name)) { out.inFlight++; continue; }
    out.files.push(child);
  }
  return out;
}

async function readRegular(file: string): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isFile()) throw new BackupError("NOT_REGULAR_FILE"); return await handle.readFile(); }
  finally { await handle.close(); }
}

async function writeExclusive(file: string, bytes: Buffer | string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

async function absent(target: string) {
  try { await lstat(target); return false; } catch (error) { if (errno(error) === "ENOENT") return true; throw new BackupError("DESTINATION_UNREADABLE"); }
}

async function emptyOrAbsent(target: string) {
  try {
    const info = await lstat(target);
    if (!info.isDirectory()) return false;
    return (await readdir(target)).length === 0;
  } catch (error) { if (errno(error) === "ENOENT") return true; throw new BackupError("DESTINATION_UNREADABLE"); }
}

export async function createBackup(sources: BackupSource[], destination: string, now = new Date()): Promise<BackupSummary> {
  if (!sources.length || new Set(sources.map(s => s.label)).size !== sources.length) throw new BackupError("INVALID_SOURCES");
  const target = path.resolve(destination);
  for (const source of sources) {
    const from = path.resolve(source.directory);
    if (target === from || target.startsWith(from + path.sep)) throw new BackupError("DESTINATION_INSIDE_SOURCE");
  }
  if (!(await absent(target))) throw new BackupError("DESTINATION_EXISTS");
  const listed = await Promise.all(sources.map(async source => ({ source, ...(await walk(path.resolve(source.directory))) })));
  if (listed.some(item => item.inFlight > 0)) throw new BackupError("WRITER_ACTIVE");
  await mkdir(target, { recursive: false, mode: 0o700 }).catch(() => { throw new BackupError("DESTINATION_EXISTS"); });
  const manifest: BackupManifest = { version: 1, origin: "MONITOR_DATA_BACKUP", createdAt: now.toISOString(), sources: [] };
  let bytes = 0, files = 0;
  try {
    for (const item of listed) {
      const entries: ManifestFile[] = [];
      for (const rel of item.files) {
        const content = await readRegular(path.join(path.resolve(item.source.directory), rel));
        await writeExclusive(path.join(target, item.source.label, rel), content);
        entries.push({ path: rel, size: content.length, sha256: sha(content) });
        bytes += content.length; files++;
      }
      manifest.sources.push({ label: item.source.label, files: entries });
    }
    await writeExclusive(path.join(target, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  } catch (error) {
    // A partial copy is not a backup: remove only the directory this invocation created.
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw error instanceof BackupError ? error : new BackupError("COPY_FAILED");
  }
  return { files, bytes, skippedSymlinks: listed.reduce((n, item) => n + item.symlinks, 0), manifest: path.join(target, MANIFEST) };
}

const safeRel = (rel: string) => typeof rel === "string" && rel.length > 0 && rel.length < 1024 && !rel.startsWith("/") && !rel.split("/").some(part => !part || part === "." || part === "..") && !/[\u0000-\u001f\\]/.test(rel);

/** Verifies every manifest entry (size and SHA-256) and that no unlisted file exists. */
export async function verifyBackup(backup: string): Promise<BackupManifest> {
  const root = path.resolve(backup);
  let manifest: BackupManifest;
  try { manifest = JSON.parse((await readRegular(path.join(root, MANIFEST))).toString("utf8")) as BackupManifest; }
  catch { throw new BackupError("MANIFEST_INVALID"); }
  if (manifest?.version !== 1 || manifest.origin !== "MONITOR_DATA_BACKUP" || !Array.isArray(manifest.sources) || manifest.sources.some(s => !LABEL.test(s?.label) || !Array.isArray(s.files) || s.files.some(f => !safeRel(f?.path) || !Number.isSafeInteger(f.size) || !/^[a-f0-9]{64}$/.test(f.sha256)))) throw new BackupError("MANIFEST_INVALID");
  const listed = new Set<string>([MANIFEST]);
  for (const source of manifest.sources) {
    for (const file of source.files) {
      const rel = `${source.label}/${file.path}`;
      listed.add(rel);
      let content: Buffer;
      try { content = await readRegular(path.join(root, rel)); } catch { throw new BackupError("FILE_MISSING"); }
      if (content.length !== file.size || sha(content) !== file.sha256) throw new BackupError("CHECKSUM_MISMATCH");
    }
  }
  const present = await walk(root);
  if (present.symlinks || present.files.some(rel => !listed.has(rel))) throw new BackupError("UNLISTED_CONTENT");
  return manifest;
}

/** Restores a verified backup into empty or absent directories; nothing is copied if verification fails. */
export async function restoreBackup(backup: string, targets: Partial<Record<BackupSource["label"], string>>): Promise<{ files: number; bytes: number }> {
  const manifest = await verifyBackup(backup);
  for (const source of manifest.sources) {
    const target = targets[source.label];
    if (!target) throw new BackupError("MISSING_TARGET");
    if (!(await emptyOrAbsent(path.resolve(target)))) throw new BackupError("TARGET_NOT_EMPTY");
  }
  let files = 0, bytes = 0;
  for (const source of manifest.sources) {
    const target = path.resolve(targets[source.label]!);
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const file of source.files) {
      const content = await readRegular(path.join(path.resolve(backup), source.label, file.path));
      if (sha(content) !== file.sha256) throw new BackupError("CHECKSUM_MISMATCH");
      await writeExclusive(path.join(target, file.path), content);
      files++; bytes += content.length;
    }
  }
  return { files, bytes };
}
