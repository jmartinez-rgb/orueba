import { vi } from "vitest";

// Ninguna prueba sale a internet: el fetch global falla de inmediato. Cada integración se prueba
// con su simulador inyectado; si alguna prueba olvidara inyectarlo, fallaría en vez de llamar a la
// plataforma real.
vi.stubGlobal("fetch", async (input: unknown) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`Red deshabilitada en pruebas: ${new URL(url).host}`);
});
