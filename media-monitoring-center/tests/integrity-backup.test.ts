import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup, verifyBackup } from "@/lib/release/data-backup";
import { FileRecordStore } from "@/lib/records/store";

const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "backup-")); dirs.push(root);
  const records = join(root, "records"), unified = join(root, "unified");
  const store = new FileRecordStore(records);
  await store.set("users/accounts", { version: 1, note: "ficticio" });
  await store.set("absolute-top/izzi/8779536058", { version: 1, audits: [] });
  await mkdir(join(unified, "google"), { recursive: true });
  await writeFile(join(unified, "google", "catalog.json"), JSON.stringify({ campaigns: [] }));
  await writeFile(join(root, "fuera.json"), "secreto-fuera-del-volumen");
  return { root, records, unified, sources: [{ label: "records" as const, directory: records }, { label: "unified" as const, directory: unified }] };
}

describe("respaldo y restauración del volumen privado", () => {
  it("copia con manifiesto SHA-256, permisos privados y sin seguir enlaces simbólicos", async () => {
    const w = await workspace();
    await symlink(join(w.root, "fuera.json"), join(w.records, "enlace.json"));
    const summary = await createBackup(w.sources, join(w.root, "respaldo"));
    expect(summary).toMatchObject({ files: 3, skippedSymlinks: 1 });
    expect((await stat(join(w.root, "respaldo"))).mode & 0o777).toBe(0o700);
    expect((await stat(summary.manifest)).mode & 0o777).toBe(0o600);
    expect((await stat(join(w.root, "respaldo", "unified", "google", "catalog.json"))).mode & 0o777).toBe(0o600);
    const manifest = await verifyBackup(join(w.root, "respaldo"));
    expect(manifest.sources.map(s => s.label)).toEqual(["records", "unified"]);
    expect(JSON.stringify(manifest)).not.toContain("secreto-fuera");
  });
  it("no sobrescribe, no copia dentro del origen y se niega con un escritor activo", async () => {
    const w = await workspace();
    await mkdir(join(w.root, "existe"));
    await expect(createBackup(w.sources, join(w.root, "existe"))).rejects.toThrow(/DESTINATION_EXISTS/);
    await expect(createBackup(w.sources, join(w.records, "dentro"))).rejects.toThrow(/DESTINATION_INSIDE_SOURCE/);
    await writeFile(join(w.records, "users", "accounts.json.lock"), "{}");
    await expect(createBackup(w.sources, join(w.root, "con-lock"))).rejects.toThrow(/WRITER_ACTIVE/);
  });
  it("la verificación detecta alteraciones, faltantes y contenido no listado", async () => {
    const w = await workspace();
    const backup = join(w.root, "respaldo");
    await createBackup(w.sources, backup);
    const file = join(backup, "unified", "google", "catalog.json");
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace("[]", "[1]"));
    await expect(verifyBackup(backup)).rejects.toThrow(/CHECKSUM_MISMATCH/);
    await rm(file);
    await expect(verifyBackup(backup)).rejects.toThrow(/FILE_MISSING/);
    await writeFile(file, original);
    await writeFile(join(backup, "records", "extra.json"), "{}");
    await expect(verifyBackup(backup)).rejects.toThrow(/UNLISTED_CONTENT/);
  });
  it("restaura en destinos vacíos y no copia nada si el respaldo está alterado", async () => {
    const w = await workspace();
    const backup = join(w.root, "respaldo");
    await createBackup(w.sources, backup);
    const target = { records: join(w.root, "r2"), unified: join(w.root, "u2") };
    expect(await restoreBackup(backup, target)).toMatchObject({ files: 3 });
    expect(await new FileRecordStore(target.records).get("users/accounts")).toEqual({ version: 1, note: "ficticio" });
    await expect(restoreBackup(backup, target)).rejects.toThrow(/TARGET_NOT_EMPTY/);
    await writeFile(join(backup, "records", "users", "accounts.json"), "{\"alterado\":true}");
    const clean = { records: join(w.root, "r3"), unified: join(w.root, "u3") };
    await expect(restoreBackup(backup, clean)).rejects.toThrow(/CHECKSUM_MISMATCH/);
    await expect(stat(clean.records)).rejects.toThrow();
  });
  it("el comando solo imprime conteos y códigos", async () => {
    const w = await workspace();
    const env = { ...process.env, RECORDS_DIR: w.records, UNIFIED_ADS_DATA_DIR: w.unified };
    const out = await run(process.execPath, ["--import", "tsx", "scripts/data-backup.ts", "respaldar", "--destino", join(w.root, "cli")], { cwd: process.cwd(), env });
    expect(JSON.parse(out.stdout)).toMatchObject({ step: "backup", files: 3 });
    expect(out.stdout).not.toContain("accounts");
    const verify = await run(process.execPath, ["--import", "tsx", "scripts/data-backup.ts", "verificar", "--respaldo", join(w.root, "cli")], { cwd: process.cwd(), env });
    expect(JSON.parse(verify.stdout)).toMatchObject({ step: "verify", ok: true, files: 3 });
    const failed = await run(process.execPath, ["--import", "tsx", "scripts/data-backup.ts", "respaldar", "--destino", join(w.root, "cli")], { cwd: process.cwd(), env }).catch((e: { code: number; stderr: string }) => e);
    expect(failed).toMatchObject({ code: 1 });
    expect((failed as { stderr: string }).stderr).toContain("DESTINATION_EXISTS");
  }, 30000);
});
