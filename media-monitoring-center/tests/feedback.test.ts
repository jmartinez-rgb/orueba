import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/roles";
import { createFeedback, listFeedback, listFeedbackBy, newFeedbackCount, updateFeedback } from "@/lib/records/feedback";

describe("bugs y sugerencias", () => {
  it("solo el administrador gestiona la bandeja", () => {
    expect(can("admin", "feedback:manage")).toBe(true);
    expect(can("coadmin", "feedback:manage")).toBe(false);
    expect(can("manager", "feedback:manage")).toBe(false);
    expect(can("viewer", "feedback:manage")).toBe(false);
    // El co-administrador conserva el resto de permisos.
    expect(can("coadmin", "settings:write")).toBe(true);
  });

  it("guarda con folio, separa por autor y registra el seguimiento", async () => {
    const ana = { id: "invitado:ana-lopez", name: "Ana López", role: "viewer" };
    const ops = { id: "operaciones", name: "Operaciones", role: "coadmin" };
    const a = await createFeedback({ kind: "BUG", title: "No carga el mensaje", description: "Al abrir Monitoreos se queda cargando.", page: "/monitoreos", impact: "ALTO" }, ana, "Chrome · macOS");
    const b = await createFeedback({ kind: "SUGERENCIA", title: "Comparar vs mes anterior", description: "Sería útil en Compare para cierres.", page: null, impact: "BAJO" }, ops, null);
    expect(a.id).toMatch(/^FB-\d{4}$/);
    expect(b.id).not.toBe(a.id);
    expect(a.status).toBe("NUEVO");
    expect((await listFeedbackBy(ana.id)).map((f) => f.id)).toEqual([a.id]);
    expect((await listFeedback()).length).toBeGreaterThanOrEqual(2);
    const before = await newFeedbackCount();
    const upd = await updateFeedback(a.id, { status: "EN_PROCESO", adminNote: "Lo revisamos hoy." }, "J. Martínez");
    expect(upd?.status).toBe("EN_PROCESO");
    expect(upd?.adminNote).toBe("Lo revisamos hoy.");
    expect(upd?.updates.at(-1)?.by).toBe("J. Martínez");
    expect(await newFeedbackCount()).toBe(before - 1);
    expect(await updateFeedback("FB-9999", { status: "RESUELTO" }, "x")).toBeNull();
  });
});
