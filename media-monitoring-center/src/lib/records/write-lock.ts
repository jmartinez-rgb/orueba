import "server-only";

// Shared by route bundles and store objects in this process, not by other servers.
const state = globalThis as unknown as { __immcRecordWrites?: Map<string, Promise<void>> };

export async function withRecordWrite<T>(scope: string, write: () => Promise<T>): Promise<T> {
  const writes = state.__immcRecordWrites ??= new Map();
  const previous = writes.get(scope) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  writes.set(scope, current);
  await previous;
  try { return await write(); }
  finally {
    release();
    if (writes.get(scope) === current) writes.delete(scope);
  }
}
