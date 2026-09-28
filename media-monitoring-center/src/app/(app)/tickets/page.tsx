import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { listTickets, OPEN_TICKET_STATUSES, TICKET_CATEGORY_LABEL, type TicketCategory } from "@/lib/records/tickets";
import { getRecordStore, RECORD_BACKEND_LABEL } from "@/lib/records/store";
import { safeSnapshot } from "@/lib/services/safe";
import { categoryFor } from "@/lib/services/critical";
import { baseSettings } from "@/lib/services/context";
import { durationLabel, monthOf, businessDate } from "@/lib/time/tz";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { TicketsBoard, type IncidentOption } from "@/components/tickets/tickets-board";

export const metadata: Metadata = { title: "Tickets" };
export const dynamic = "force-dynamic";

/** Hora de referencia del request (servidor) para calcular antigüedades. */
function requestNow(): number {
  return Date.now();
}

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ new?: string; id?: string }> }) {
  const session = await requireSession("/tickets");
  const sp = await searchParams;
  const [tickets, snapRes] = await Promise.all([listTickets(), safeSnapshot()]);
  const tz = snapRes.ok ? snapRes.snap.meta.timezone : baseSettings().timezone;
  const incidents: IncidentOption[] = snapRes.ok
    ? snapRes.snap.state.incidents
        .slice()
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((i) => ({ id: i.id, title: i.title, platform: i.platform, severity: i.resolvedAt ? i.maxSeverity : i.severity, accountName: i.accountName, open: i.resolvedAt === null, category: categoryFor(i.type) }))
    : [];
  const open = tickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status));
  const month = monthOf(businessDate(new Date(), tz));
  const resolvedMonth = tickets.filter((t) => t.resolvedAt && monthOf(businessDate(new Date(t.resolvedAt), tz)) === month);
  const withTime = tickets.filter((t) => t.resolvedAt);
  const mttr = withTime.length ? withTime.reduce((a, t) => a + (Date.parse(t.resolvedAt!) - Date.parse(t.createdAt)), 0) / withTime.length : null;
  const byCategory = Object.entries(
    tickets.reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tickets de reporte"
        subtitle={`Histórico de problemas graves reportados: a quién, por qué canal, número de caso y seguimiento. Registro interno (${RECORD_BACKEND_LABEL[getRecordStore().backend]}); no abre casos en las plataformas.`}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Abiertos" value={String(open.length)} />
        <Stat label="Resueltos este mes" value={String(resolvedMonth.length)} />
        <Stat label="Tiempo medio de resolución" value={mttr === null ? "—" : durationLabel(mttr)} />
        <Stat label="Categoría más frecuente" value={byCategory[0] ? TICKET_CATEGORY_LABEL[byCategory[0][0] as TicketCategory] : "—"} />
      </div>
      <Card>
        <CardContent className="pt-4">
          <TicketsBoard
            tickets={tickets}
            incidents={incidents}
            timezone={tz}
            canWrite={can(session.role, "tickets:write")}
            canManage={can(session.role, "tickets:manage")}
            prefillIncidentId={sp.new && /^INC-\d+$/.test(sp.new) ? sp.new : null}
            initialId={sp.id && /^TKT-\d+$/.test(sp.id) ? sp.id : null}
            nowMs={requestNow()}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tabular truncate text-xl font-bold">{value}</p>
    </div>
  );
}
