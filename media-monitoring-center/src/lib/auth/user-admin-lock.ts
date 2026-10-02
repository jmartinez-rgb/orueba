import "server-only";

// Route bundles share this queue within one process. Separate instances still require
// a storage transaction or compare-and-set; atomic file replacement is not enough.
const state = globalThis as unknown as { __immcUserAdminWrite?: Promise<void> };

export async function withUserAdminWrite<T>(write: () => Promise<T>): Promise<T> {
  const previous = state.__immcUserAdminWrite ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  state.__immcUserAdminWrite = current;
  await previous;
  try { return await write(); }
  finally {
    release();
    if (state.__immcUserAdminWrite === current) delete state.__immcUserAdminWrite;
  }
}
