import { vi } from "vitest";

// El baseline permanece bloqueado incluso después de vi.unstubAllGlobals(). Cada integración
// usa un simulador inyectado; un fixture omitido falla localmente, sin copiar URLs ni secretos.
// Esta barrera cubre fetch; no afirma bloquear otros transportes como node:http.
const blockedFetch: typeof fetch = async () => {
  throw new Error("Red de fetch deshabilitada en pruebas; inyecta un transporte local.");
};
globalThis.fetch = blockedFetch;
vi.stubGlobal("fetch", blockedFetch);
