import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { buildXlsx, type XlsxSheet } from "../utils/xlsx.js";

/** Exclusive private output: never replace an existing report or follow a destination symlink. */
export async function writeWorkbook(prefix: string, sheets: XlsxSheet[], output?: string): Promise<string> {
  if (output && !output.toLowerCase().endsWith(".xlsx")) throw new Error("La salida debe ser .xlsx.");
  const path = resolve(
    output ??
      `reportes/${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.xlsx`,
  );
  const bytes = buildXlsx(sheets);
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.close();
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw error;
  }
  return path;
}
