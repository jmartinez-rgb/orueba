import "server-only";
import { auditIncidents, type IncidentAudit, type AuditSummary } from "@/lib/audit/incident-audit";
import type { CriticalAck } from "@/lib/records/acks";
import { listAcks } from "@/lib/records/acks";
import { listReviews } from "@/lib/records/incident-reviews";
import { listNovedades } from "@/lib/records/novedades";
import { listReports } from "@/lib/records/reports";
import { mapLimit } from "@/lib/records/store";
import { listTickets } from "@/lib/records/tickets";
import type { Snapshot } from "./snapshot";

export interface AuditView {
  days: number;
  from: string;
  rows: IncidentAudit[];
  summary: AuditSummary;
  /** Fuentes que no se pudieron leer (la auditoría sigue con lo disponible y lo avisa). */
  warnings: string[];
}

/** Junta lo que el equipo dejó registrado y audita los incidentes de la marca del periodo. */
export async function buildAuditView(snap: Snapshot, days: number): Promise<AuditView> {
  const brand = snap.meta.brand.id;
  const now = new Date(snap.meta.asOf);
  const from = new Date(now.getTime() - days * 86_400_000);
  const warnings: string[] = [];
  const safe = async <T>(label: string, work: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work;
    } catch {
      warnings.push(`No se pudo leer ${label}; la auditoría no lo considera.`);
      return fallback;
    }
  };
  const incidents = snap.state.incidents;
  const [tickets, reports, novedades, reviews, ackLists] = await Promise.all([
    safe("tickets", listTickets(brand), []),
    safe("mensajes de monitoreo", listReports(Math.max(days + 1, 2), brand), []),
    safe("novedades", listNovedades(brand), []),
    safe("dictámenes", listReviews(brand), {}),
    // Solo los críticos tienen acuse.
    safe(
      "acuses críticos",
      mapLimit(
        incidents.filter((i) => i.maxSeverity === "CRITICAL"),
        8,
        async (i) => [i.id, await listAcks(i.id, i.startedAt)] as const,
      ),
      [] as Array<readonly [string, CriticalAck[]]>,
    ),
  ]);
  const { rows, summary } = auditIncidents(
    {
      incidents,
      tickets,
      reports,
      novedades,
      reviews,
      acks: Object.fromEntries(ackLists),
      notifications: snap.state.notifications,
      now,
      notifyMinSeverity: snap.settings.alerts.notifyMinSeverity,
    },
    from,
  );
  return { days, from: from.toISOString(), rows, summary, warnings };
}
