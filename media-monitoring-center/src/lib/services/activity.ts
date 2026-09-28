import "server-only";
import { headers } from "next/headers";
import { auditUser, type Session } from "@/lib/auth/session";
import { recordAudit, requestInfo, type AuditType } from "@/lib/records/audit";
import { logger } from "@/lib/logging/logger";

/** Registra en la bitácora una acción de la persona (nunca bloquea la operación si falla). */
export async function logActivity(session: Session, type: AuditType, detail: string): Promise<void> {
  try {
    await recordAudit({ type, user: auditUser(session), detail, ...requestInfo(await headers()), sid: session.sid });
  } catch (err) {
    logger.warn("audit.write_failed", { type, error: err });
  }
}
