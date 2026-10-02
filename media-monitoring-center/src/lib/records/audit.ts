import "server-only";
import { randomUUID } from "node:crypto";
import type { Role } from "@/lib/auth/roles";
import { addDays, businessDate } from "@/lib/time/tz";
import { getRecordStore, readImmutable, stamp } from "./store";

/**
 * Bitácora de accesos y actividad. Cada evento es un registro inmutable
 * (`audit/<fecha>/<marca>-<id>`); el directorio de usuarios (`users/<id>`) guarda el
 * último acceso de cada persona. No se guardan contraseñas ni IP completas.
 */

export type AuditType =
  | "LOGIN_OK"
  | "LOGIN_FAILED"
  | "LOGIN_BLOCKED"
  | "LOGOUT"
  | "CRITICAL_ACK"
  | "TICKET_CREATED"
  | "TICKET_UPDATED"
  | "REPORT_GENERATED"
  | "SETTINGS_CHANGED"
  | "ALERT_STATUS"
  | "INCIDENT_UPDATED"
  | "BUDGET_REFERENCE"
  | "EVALUATION_TRIGGERED"
  | "FEEDBACK_SENT"
  | "FEEDBACK_UPDATED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DELETED"
  | "PASSWORD_CHANGED"
  | "UNIVERSAL_UPDATED"
  | "NOVEDAD_CREATED"
  | "NOVEDAD_UPDATED"
  | "KICKOFF_CONFIRMED"
  | "AUDIT_REVIEWED";

export const AUDIT_LABEL: Record<AuditType, string> = {
  LOGIN_OK: "Inicio de sesión",
  LOGIN_FAILED: "Intento fallido",
  LOGIN_BLOCKED: "Acceso bloqueado temporalmente",
  LOGOUT: "Cierre de sesión",
  CRITICAL_ACK: "Acuse de alerta crítica",
  TICKET_CREATED: "Ticket creado",
  TICKET_UPDATED: "Ticket actualizado",
  REPORT_GENERATED: "Mensaje de monitoreo guardado",
  SETTINGS_CHANGED: "Configuración modificada",
  ALERT_STATUS: "Estado de alerta",
  INCIDENT_UPDATED: "Incidente actualizado",
  BUDGET_REFERENCE: "Presupuesto de referencia",
  EVALUATION_TRIGGERED: "Evaluación manual",
  FEEDBACK_SENT: "Bug o sugerencia enviado",
  FEEDBACK_UPDATED: "Bug o sugerencia actualizado",
  USER_CREATED: "Cuenta creada",
  USER_UPDATED: "Cuenta modificada",
  USER_DELETED: "Cuenta eliminada",
  PASSWORD_CHANGED: "Contraseña cambiada",
  UNIVERSAL_UPDATED: "Contraseña universal modificada",
  NOVEDAD_CREATED: "Novedad registrada",
  NOVEDAD_UPDATED: "Novedad actualizada",
  KICKOFF_CONFIRMED: "Arranque de mes confirmado",
  AUDIT_REVIEWED: "Dictamen de auditoría",
};

export type AuditUserKind = "named" | "universal" | "open" | "header" | "anon";

export interface AuditUser {
  id: string;
  name: string;
  role: Role | null;
  kind: AuditUserKind;
}

export interface AuditRecord {
  id: string;
  at: string;
  type: AuditType;
  user: AuditUser;
  detail: string | null;
  ip: string | null;
  agent: string | null;
  sid: string | null;
}

export interface UserDirectoryEntry {
  id: string;
  name: string;
  role: Role | null;
  kind: AuditUserKind;
  firstSeenAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string;
  logins: number;
  lastAgent: string | null;
}

interface StoredUserDirectoryEntry extends UserDirectoryEntry {
  /** Bounded replay receipts; never exposed in the directory response. */
  appliedOperations?: string[];
}

function publicDirectoryEntry(entry: StoredUserDirectoryEntry): UserDirectoryEntry {
  const result = { ...entry };
  delete result.appliedOperations;
  return result;
}

const TZ = () => process.env.APP_TIMEZONE || "America/Mexico_City";

/** IP enmascarada (último bloque oculto) para ubicar accesos sin guardar la IP completa. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0].trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(first)) return first.replace(/\.\d+$/, ".x");
  if (first.includes(":")) return first.split(":").slice(0, 3).join(":") + "::x";
  return null;
}

/** Navegador y sistema en pocas palabras (sin guardar el user-agent completo). */
export function summarizeAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Otro navegador";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "otro sistema";
  return `${browser} · ${os}`;
}

export function requestInfo(headers: Headers): { ip: string | null; agent: string | null } {
  const ip = headers.get("x-nf-client-connection-ip") ?? headers.get("x-real-ip") ?? headers.get("x-forwarded-for");
  return { ip: maskIp(ip), agent: summarizeAgent(headers.get("user-agent")) };
}

function rand() {
  return Math.random().toString(36).slice(2, 8);
}

export async function recordAudit(input: Omit<AuditRecord, "id" | "at"> & { at?: Date }): Promise<AuditRecord> {
  const at = input.at ?? new Date();
  const day = businessDate(at, TZ());
  const id = `${stamp(at)}-${rand()}`;
  const rec: AuditRecord = { id, at: at.toISOString(), type: input.type, user: input.user, detail: input.detail?.slice(0, 500) ?? null, ip: input.ip, agent: input.agent, sid: input.sid };
  await getRecordStore().set(`audit/${day}/${id}`, rec);
  return rec;
}

export async function listAudit(opts: { days?: number; types?: AuditType[]; limit?: number } = {}): Promise<AuditRecord[]> {
  const store = getRecordStore();
  const days = Math.min(Math.max(opts.days ?? 14, 1), 120);
  const today = businessDate(new Date(), TZ());
  const dates = Array.from({ length: days }, (_, i) => addDays(today, -i));
  const keyLists = await Promise.all(dates.map((d) => store.list(`audit/${d}/`)));
  const keys = keyLists.flat().sort().reverse().slice(0, Math.min(opts.limit ?? 500, 2000));
  const records = await readImmutable<AuditRecord>(store, keys);
  const filtered = opts.types ? records.filter((r) => opts.types!.includes(r.type)) : records;
  return filtered.sort((a, b) => b.at.localeCompare(a.at));
}

export async function touchUser(user: AuditUser, opts: { login?: boolean; agent?: string | null } = {}): Promise<void> {
  if (user.kind === "anon") return;
  const store = getRecordStore();
  const key = `users/${encodeURIComponent(user.id)}`;
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const recentlySeen = (cur: UserDirectoryEntry | null) => cur !== null && nowMs - Date.parse(cur.lastSeenAt) < 5 * 60 * 1000;
  // Evita escrituras en cada request: la presencia se actualiza cada 5 minutos como máximo.
  if (!opts.login && recentlySeen(await store.get<UserDirectoryEntry>(key))) return;
  // CAS may replay this pure transform; generating its ID and timestamp here keeps
  // a confirmed login from being counted twice while its receipt is retained.
  const operationId = randomUUID();
  await store.update<StoredUserDirectoryEntry>(key, cur => {
    if (cur?.appliedOperations?.includes(operationId) || (!opts.login && recentlySeen(cur))) return cur;
    const latest = !cur || now >= cur.lastSeenAt;
    return {
      id: user.id,
      name: latest ? user.name : cur!.name,
      role: latest ? user.role : cur!.role,
      kind: latest ? user.kind : cur!.kind,
      firstSeenAt: cur && cur.firstSeenAt < now ? cur.firstSeenAt : now,
      lastLoginAt: opts.login && (!cur?.lastLoginAt || now > cur.lastLoginAt) ? now : (cur?.lastLoginAt ?? null),
      lastSeenAt: latest ? now : cur!.lastSeenAt,
      logins: (cur?.logins ?? 0) + (opts.login ? 1 : 0),
      lastAgent: latest ? (opts.agent ?? cur?.lastAgent ?? null) : cur!.lastAgent,
      appliedOperations: [...(cur?.appliedOperations ?? []), operationId].slice(-50),
    };
  });
}

export async function listUsers(): Promise<UserDirectoryEntry[]> {
  const store = getRecordStore();
  const keys = await store.list("users/");
  const rows = await Promise.all(keys.map((k) => store.get<StoredUserDirectoryEntry>(k)));
  return rows.filter((r): r is StoredUserDirectoryEntry => r !== null).map(publicDirectoryEntry).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}
