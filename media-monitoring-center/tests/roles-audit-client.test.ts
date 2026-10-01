import { describe, expect, it } from "vitest";
import { effectivePermissions, isInternalRole, isRole, permissionsOf, ROLES, type Permission } from "@/lib/auth/roles";
import { auditIncident, auditIncidents, type AuditInputs } from "@/lib/audit/incident-audit";
import { buildClientView } from "@/lib/client/client-view";
import type { Incident } from "@/lib/alerts/types";
import type { Ticket } from "@/lib/records/ticket-model";
import type { PlatformId, Severity } from "@/lib/types";

const T0 = "2026-10-01T15:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

function incident(p: Partial<Incident> & { maxSeverity?: Severity } = {}): Incident {
  const sev = p.maxSeverity ?? "ALERT";
  return {
    id: "INC-0001",
    fingerprint: "platform:meta#delivery",
    alertId: "ALR-0001",
    type: "DELIVERY_ISSUE",
    title: "Caída de gasto",
    metric: "spend",
    level: "platform",
    platform: "meta",
    accountId: "act-1",
    accountName: "MXN - izzi 1",
    campaignId: null,
    campaignName: null,
    startedAt: T0,
    resolvedAt: null,
    lastUpdateAt: T0,
    severity: sev,
    maxSeverity: sev,
    currentDeviation: -0.4,
    maxDeviation: -0.4,
    status: "OPEN",
    owner: null,
    notes: [],
    actions: [],
    timeline: [{ at: T0, kind: "OPENED", severity: sev, deviation: -0.4, message: "Abierto", notified: true }],
    evidence: [],
    childAlertIds: [],
    expectedSpendShare: null,
    notification: { count: 1, lastNotifiedAt: T0, lastSeverity: sev, lastDeviation: -0.4, durationReminderSent: false },
    ...p,
  };
}

function inputs(p: Partial<AuditInputs> = {}): AuditInputs {
  return { incidents: [], tickets: [], acks: {}, reports: [], novedades: [], notifications: [], reviews: {}, now: new Date(at(60 * 24 * 7)), notifyMinSeverity: "ALERT", ...p };
}
const status = (r: ReturnType<typeof auditIncident>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe("roles: administrador, operativo, auditor y cliente", () => {
  it("existen los seis roles y el rol cliente nunca recibe permisos internos", () => {
    expect(ROLES).toEqual(["admin", "coadmin", "manager", "viewer", "auditor", "client"]);
    expect(isRole("auditor") && isRole("client") && !isRole("root")).toBe(true);
    expect(effectivePermissions("client", ["settings:write", "internal:view", "incidents:write"])).toEqual(["client:view"]);
    expect(isInternalRole("client")).toBe(false);
  });

  it("el auditor lee todo y dictamina, pero no puede operar", () => {
    const p = effectivePermissions("auditor", null);
    for (const ok of ["internal:view", "audit:view", "audit:write", "users:view"] satisfies Permission[]) expect(p).toContain(ok);
    for (const no of ["alerts:write", "incidents:write", "tickets:write", "settings:write", "novedades:write", "budgets:write", "users:manage"] satisfies Permission[])
      expect(p).not.toContain(no);
  });

  it("quien opera no dictamina su propia auditoría; el administrador sí", () => {
    expect(permissionsOf("manager")).not.toContain("audit:write");
    expect(permissionsOf("coadmin")).not.toContain("audit:write");
    expect(permissionsOf("coadmin")).toContain("audit:view");
    expect(permissionsOf("admin")).toContain("audit:write");
  });

  it("permisos personalizados guardados antes de existir el acceso interno no dejan fuera a nadie", () => {
    expect(effectivePermissions("viewer", ["tickets:write"])).toEqual(expect.arrayContaining(["tickets:write", "internal:view", "client:view"]));
  });
});

describe("auditoría de incidencias", () => {
  it("un crítico atendido a tiempo, con responsable, reportado y recuperado cumple", () => {
    const inc = incident({
      maxSeverity: "CRITICAL",
      owner: "Ana",
      resolvedAt: at(180),
      status: "RESOLVED",
      actions: [
        { at: at(12), by: "Ana", kind: "OWNER", value: "Ana" },
        { at: at(13), by: "Ana", kind: "STATUS", value: "INVESTIGATING" },
        { at: at(120), by: "Ana", kind: "NOTE", value: null },
      ],
      timeline: [{ at: at(180), kind: "RECOVERED", severity: "NORMAL", deviation: 0, message: "Recuperado", notified: true }],
    });
    const acks = { "INC-0001": [{ incidentId: "INC-0001", openedAt: T0, userId: "ana", userName: "Ana", at: at(10), text: "Revisado", reportTo: "Cynthia", ticketId: null }] };
    const r = auditIncident(inc, inputs({ acks }));
    expect(r.checks.every((c) => c.status === "ok" || c.status === "na")).toBe(true);
    expect(r).toMatchObject({ auto: "CUMPLE", score: 100, minutesToAttention: 10, firstActionBy: "Ana" });
  });

  it("una alerta que nadie atendió, sin reporte y cerrada a mano sin nota no cumple", () => {
    const inc = incident({ resolvedAt: at(80 * 60), status: "RESOLVED", actions: [{ at: at(80 * 60), by: "Luis", kind: "STATUS", value: "RESOLVED" }] });
    const r = auditIncident(inc, inputs());
    expect(status(r, "attention")).toBe("fail");
    expect(status(r, "owner")).toBe("fail");
    expect(status(r, "reported")).toBe("fail");
    expect(status(r, "closure")).toBe("fail");
    expect(status(r, "resolution")).toBe("fail");
    expect(r.auto).toBe("NO_CUMPLE");
  });

  it("un crítico recién abierto queda en curso, no como incumplimiento", () => {
    const r = auditIncident(incident({ maxSeverity: "CRITICAL" }), inputs({ now: new Date(at(10)) }));
    expect(status(r, "attention")).toBe("pending");
    expect(status(r, "reported")).toBe("pending");
    expect(r.auto).toBe("EN_CURSO");
  });

  it("un abierto que pasó más de la ventana sin actualizarse falla el seguimiento", () => {
    const inc = incident({ owner: "Ana", actions: [{ at: at(30), by: "Ana", kind: "OWNER", value: "Ana" }] });
    const r = auditIncident(inc, inputs({ now: new Date(at(30 * 60)) }));
    expect(status(r, "followup")).toBe("fail");
    const { summary } = auditIncidents(inputs({ incidents: [inc], now: new Date(at(30 * 60)) }), new Date(at(-60)));
    expect(summary.staleOpen).toBe(1);
  });

  it("un ticket o un mensaje de monitoreo de esa plataforma cuentan como reporte; notas antiguas cuentan como acción", () => {
    const inc = incident({ notes: [{ at: at(20), author: "Mario", text: "Revisando con la cuenta" }], actions: undefined });
    const ticket = { id: "TCK-0001", incidentIds: ["INC-0001"] } as unknown as Ticket;
    const withTicket = auditIncident(inc, inputs({ tickets: [ticket] }));
    expect(status(withTicket, "reported")).toBe("ok");
    expect(withTicket.firstActionBy).toBe("Mario");
    const report = { id: "RPT-1", at: at(40), businessDate: "2026-10-01", cutoffHour: 12, by: "Mario", text: "…", platforms: ["meta"], summary: "" };
    expect(status(auditIncident(inc, inputs({ reports: [report] })), "reported")).toBe("ok");
    expect(status(auditIncident(inc, inputs({ reports: [{ ...report, platforms: ["google"] }] })), "reported")).toBe("fail");
  });

  it("el resumen agrupa por responsable y calcula la mediana de atención", () => {
    const a = incident({ id: "INC-0001", owner: "Ana", actions: [{ at: at(10), by: "Ana", kind: "OWNER", value: "Ana" }] });
    const b = incident({ id: "INC-0002", owner: "Ana", actions: [{ at: at(30), by: "Ana", kind: "OWNER", value: "Ana" }] });
    const c = incident({ id: "INC-0003", owner: "Luis", actions: [{ at: at(50), by: "Luis", kind: "OWNER", value: "Luis" }] });
    const { summary } = auditIncidents(inputs({ incidents: [a, b, c], now: new Date(at(60)) }), new Date(at(-60)));
    expect(summary.medianAttentionMin).toBe(30);
    expect(summary.byPerson.map((p) => [p.person, p.incidents])).toEqual([
      ["Ana", 2],
      ["Luis", 1],
    ]);
  });
});

describe("vista del cliente", () => {
  const platforms: PlatformId[] = ["meta", "google"];
  const base = {
    platforms,
    platformStatus: { meta: { severity: "ALERT" as Severity, dataState: "OK" as const }, google: { severity: "NORMAL" as Severity, dataState: "OK" as const } } as never,
    pacing: { meta: { pctOfExpected: 0.62 }, google: { pctOfExpected: 1.01 } },
    lastDataAt: at(0),
    nextEvaluationAt: at(120),
    month: { total: { usedPct: 0.48, expectedPct: 0.5 } },
  };

  it("muestra el estado general, cada plataforma y lo que se atiende, sin nombres, notas ni IDs internos", () => {
    const inc = incident({ owner: "Ana Secreta", status: "INVESTIGATING", notes: [{ at: at(5), author: "Ana Secreta", text: "Nota interna confidencial" }] });
    const view = buildClientView({ ...base, incidents: [inc] });
    expect(view).toMatchObject({ overall: "action", headline: "Estamos atendiendo una situación", month: { usedPct: 48, expectedPct: 50 } });
    expect(view.platforms.map((p) => [p.platform, p.level, p.todayPct])).toEqual([
      ["meta", "action", 62],
      ["google", "ok", 101],
    ]);
    expect(view.attending).toEqual([{ platform: "meta", what: "Variación en la entrega de anuncios", since: T0, stage: "En atención" }]);
    const text = JSON.stringify(view);
    for (const secret of ["Ana Secreta", "Nota interna", "INC-0001", "ALR-0001", "act-1", "MXN - izzi 1"]) expect(text).not.toContain(secret);
  });

  it("todo en orden cuando no hay nada abierto; atención menor queda en observación", () => {
    const ok = buildClientView({ ...base, platformStatus: { meta: { severity: "NORMAL", dataState: "OK" }, google: { severity: "NORMAL", dataState: "OK" } } as never, incidents: [] });
    expect(ok).toMatchObject({ overall: "ok", headline: "Todo en orden", attending: [] });
    const watch = buildClientView({
      ...base,
      platformStatus: { meta: { severity: "ATTENTION", dataState: "OK" }, google: { severity: "NORMAL", dataState: "OK" } } as never,
      incidents: [incident({ maxSeverity: "ATTENTION" }), incident({ id: "INC-0009", resolvedAt: at(30) })],
    });
    expect(watch).toMatchObject({ overall: "watch", attending: [] });
  });
});
