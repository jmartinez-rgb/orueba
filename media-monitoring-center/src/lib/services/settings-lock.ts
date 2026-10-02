import "server-only";

// Shared by route bundles in this process. This is not a distributed storage lock.
const state = globalThis as unknown as { __immcSettingsWrite?: Promise<void> };

export async function withSettingsWrite<T>(write: () => Promise<T>): Promise<T> {
  const previous = state.__immcSettingsWrite ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  state.__immcSettingsWrite = current;
  await previous;
  try { return await write(); }
  finally {
    release();
    if (state.__immcSettingsWrite === current) delete state.__immcSettingsWrite;
  }
}
