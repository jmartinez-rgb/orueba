import { createHash } from "node:crypto";
import type { MonitoringSettings } from "./settings";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Hash opaco del contenido leído; no contiene destinatarios ni otros valores privados. */
export function settingsRevision(settings: MonitoringSettings, scope?: { brand: string; mode: string }): string {
  const view = scope ? { brand: scope.brand, mode: scope.mode } : undefined;
  return `"settings-${createHash("sha256").update(JSON.stringify(canonical({ settings, scope: view }))).digest("hex")}"`;
}

export function sameSettingValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}

export class SettingsConflictError extends Error {
  constructor() {
    super("Otra persona cambió la configuración. Recarga los valores vigentes antes de guardar.");
    this.name = "SettingsConflictError";
  }
}
