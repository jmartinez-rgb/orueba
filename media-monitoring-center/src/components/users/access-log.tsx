"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { AuditRecord, AuditType } from "@/lib/records/audit";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StateMessage } from "@/components/monitoring/states";
import { AnimatedTabs } from "@/components/rareui/animated-tabs";
import { UserAvatar } from "./user-avatar";

const LABEL: Record<AuditType, string> = {
  LOGIN_OK: "Inicio de sesión",
  LOGIN_FAILED: "Intento fallido",
  LOGIN_BLOCKED: "Bloqueo temporal",
  LOGOUT: "Cierre de sesión",
  CRITICAL_ACK: "Acuse crítico",
  TICKET_CREATED: "Ticket creado",
  TICKET_UPDATED: "Ticket actualizado",
  REPORT_GENERATED: "Monitoreo guardado",
  SETTINGS_CHANGED: "Configuración",
  ALERT_STATUS: "Estado de alerta",
  INCIDENT_UPDATED: "Incidente",
  BUDGET_REFERENCE: "Presupuesto ref.",
  EVALUATION_TRIGGERED: "Evaluación manual",
};

const TONE: Partial<Record<AuditType, string>> = {
  LOGIN_OK: "bg-status-normal/15 text-status-normal-text",
  LOGIN_FAILED: "bg-status-alert/15 text-status-alert-text",
  LOGIN_BLOCKED: "bg-status-critical/15 text-status-critical-text",
  CRITICAL_ACK: "bg-status-critical/15 text-status-critical-text",
};

type Filter = "all" | "access" | "failed" | "activity";
const ACCESS: AuditType[] = ["LOGIN_OK", "LOGOUT"];
const FAILED: AuditType[] = ["LOGIN_FAILED", "LOGIN_BLOCKED"];

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function AccessLog({ records, timezone }: { records: AuditRecord[]; timezone: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(100);
  const rows = useMemo(
    () =>
      records.filter((r) =>
        filter === "all" ? true : filter === "access" ? ACCESS.includes(r.type) : filter === "failed" ? FAILED.includes(r.type) : !ACCESS.includes(r.type) && !FAILED.includes(r.type),
      ),
    [records, filter],
  );
  const counts = {
    access: records.filter((r) => ACCESS.includes(r.type)).length,
    failed: records.filter((r) => FAILED.includes(r.type)).length,
    activity: records.filter((r) => !ACCESS.includes(r.type) && !FAILED.includes(r.type)).length,
  };

  function exportCsv() {
    const head = ["fecha", "evento", "persona", "rol", "detalle", "ip", "dispositivo"];
    const lines = rows.map((r) => [formatDateTimeInTz(r.at, timezone), LABEL[r.type], r.user.name, r.user.role ?? "", r.detail ?? "", r.ip ?? "", r.agent ?? ""].map((v) => csvCell(String(v))).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bitacora-accesos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AnimatedTabs
          label="Filtrar bitácora"
          active={filter}
          onChange={setFilter}
          tabs={[
            { id: "all", label: "Todo", count: records.length },
            { id: "access", label: "Accesos", count: counts.access },
            { id: "failed", label: "Fallidos", count: counts.failed },
            { id: "activity", label: "Actividad", count: counts.activity },
          ]}
        />
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download /> Exportar CSV
        </Button>
      </div>
      {rows.length === 0 ? (
        <StateMessage kind="empty" compact title="Sin registros en este filtro" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha y hora</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Persona</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Dispositivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular text-xs whitespace-nowrap">{formatDateTimeInTz(r.at, timezone)}</TableCell>
                  <TableCell>
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONE[r.type] ?? "bg-muted text-foreground")}>{LABEL[r.type]}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <UserAvatar name={r.user.name} size={22} />
                      <span className="text-xs font-medium">{r.user.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[340px] truncate text-xs text-muted-foreground" title={r.detail ?? undefined}>
                    {r.detail ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{r.ip ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.agent ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length > limit && (
            <div className="pt-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 100)}>
                Ver más ({rows.length - limit} restantes)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
