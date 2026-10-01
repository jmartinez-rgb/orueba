import { describe, expect, it, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Un fallo de lectura distinto de "no existe" (EIO, EACCES) no puede tratarse como archivo vacío.
const failRead = { path: "" };
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof FsPromises>();
  return {
    ...fs,
    readFile: (async (path: unknown, ...rest: unknown[]) => {
      if (failRead.path && String(path) === failRead.path)
        throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
      return (fs.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof fs.readFile,
  };
});

const { saveRotatedToken, readTokenStore } = await import("../src/config/token-store.js");
const { updateEnvFile } = await import("../src/config/env-file.js");
const dir = () => mkdtempSync(join(tmpdir(), "uaa-token-files-"));

describe("auditoría: almacén de tokens rotados", () => {
  it("un fallo de lectura no borra los demás tokens guardados", async () => {
    const path = join(dir(), "tokens.env");
    writeFileSync(path, "SPOTIFY_ADS_REFRESH_TOKEN=spotify-sintetico\nMICROSOFT_ADS_REFRESH_TOKEN=viejo\n", {
      mode: 0o600,
    });
    failRead.path = path;
    try {
      await expect(saveRotatedToken(path, "MICROSOFT_ADS_REFRESH_TOKEN", "nuevo")).rejects.toThrow();
    } finally {
      failRead.path = "";
    }
    expect(readFileSync(path, "utf8")).toContain("SPOTIFY_ADS_REFRESH_TOKEN=spotify-sintetico");
  });

  it("si la escritura falla no deja temporales con el token en disco", async () => {
    const base = dir(),
      path = join(base, "tokens.env");
    mkdirSync(path); // la ruta es un directorio: el reemplazo no puede completarse
    await expect(saveRotatedToken(path, "MICROSOFT_ADS_REFRESH_TOKEN", "nuevo")).rejects.toThrow();
    expect(readdirSync(base).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("al arrancar, un almacén que existe pero no se puede leer no se ignora en silencio", () => {
    const path = dir(); // un directorio: lectura con EISDIR
    expect(() => readTokenStore(path)).toThrow(/TOKEN_STORE_FILE/);
    expect(readTokenStore(join(dir(), "no-existe.env"))).toEqual({});
  });
});

describe("auditoría: escritura de .env de los asistentes", () => {
  it("conserva líneas ajenas, deja 0600 y no deja temporales", async () => {
    const base = dir(),
      path = join(base, ".env");
    writeFileSync(path, "# comentario\nMETA_ACCESS_TOKEN=meta\nGOOGLE_ADS_REFRESH_TOKEN=viejo\n", { mode: 0o644 });
    await updateEnvFile(path, { GOOGLE_ADS_REFRESH_TOKEN: "nuevo" });
    const content = readFileSync(path, "utf8");
    expect(content).toContain("# comentario\nMETA_ACCESS_TOKEN=meta\n");
    expect(content).toContain(`GOOGLE_ADS_REFRESH_TOKEN="nuevo"`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(base)).toEqual([".env"]);
  });

  it("crea el archivo si no existe y rechaza enlaces simbólicos", async () => {
    const base = dir();
    await updateEnvFile(join(base, ".env"), { TIKTOK_ACCESS_TOKEN: "t" });
    expect(readFileSync(join(base, ".env"), "utf8")).toContain(`TIKTOK_ACCESS_TOKEN="t"`);
    const target = join(base, "otro.env");
    writeFileSync(target, "X=1\n");
    symlinkSync(target, join(base, "enlace.env"));
    await expect(updateEnvFile(join(base, "enlace.env"), { A: "b" })).rejects.toThrow(/archivo normal/);
    expect(readFileSync(target, "utf8")).toBe("X=1\n");
  });

  it("rechaza valores con saltos de línea", async () => {
    await expect(updateEnvFile(join(dir(), ".env"), { A: "x\nB=y" })).rejects.toThrow();
  });
});
