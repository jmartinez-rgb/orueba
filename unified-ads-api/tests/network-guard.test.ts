import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("fetch transport barrier", () => {
  it("fails locally before transport without leaking the destination or query", async () => {
    const error = await fetch("https://fixture.invalid/private-report?token=SYNTHETIC_SECRET").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Red de fetch deshabilitada en pruebas; inyecta un transporte local.");
    expect(String(error)).not.toContain("fixture.invalid");
    expect(String(error)).not.toContain("SYNTHETIC_SECRET");
  });

  it("unstubAllGlobals restores the blocked baseline instead of native fetch", async () => {
    const blockedBaseline = globalThis.fetch;
    vi.stubGlobal("fetch", async () => Response.json({ fixture: true }));
    expect(await (await fetch("https://fixture.invalid")).json()).toEqual({ fixture: true });
    vi.unstubAllGlobals();
    // Assert identity before invoking it: a regression must fail without contacting any host.
    expect(globalThis.fetch).toBe(blockedBaseline);
    await expect(fetch("https://fixture.invalid")).rejects.toThrow("Red de fetch deshabilitada en pruebas");
  });
});
