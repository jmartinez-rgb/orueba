/** Default transport stays blocked even after a test restores its explicit fetch fixture. */
globalThis.fetch = async () => {
  throw new Error("Red deshabilitada en pruebas: inyecta un simulador de fetch.");
};
