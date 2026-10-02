import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("barrera de fetch en pruebas", () => {
  it("bloquea el transporte por defecto sin registrar credenciales ni URL", async () => {
    const url = "https://fixture.invalid/callback?code=fictional-private-code";
    await expect(fetch(url, { headers: { Authorization: "Bearer fictional-private-token" } })).rejects.toThrow("Red deshabilitada en pruebas");
  });

  it("restaurar un simulador explícito conserva el bloqueo de red", async () => {
    const fixture = vi.fn(async () => Response.json({ fixture: true }));
    vi.stubGlobal("fetch", fixture);
    expect(await (await fetch("https://fixture.invalid/")).json()).toEqual({ fixture: true });
    expect(fixture).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    await expect(fetch("https://fixture.invalid/")).rejects.toThrow("Red deshabilitada en pruebas");
  });
});
