import "server-only";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { FileRecordStore } from "@/lib/records/store";
import { attemptSchema, catalogSchema, mappingSchema, partitionSchema, sameScope, UnifiedDataError, type ApiCatalog, type ApiPartition, type SyncAttempt, type UnifiedMapping, type UnifiedScope } from "./schema";
import { getEnv } from "@/lib/config/env";

export async function loadUnifiedMapping(): Promise<UnifiedMapping> {
  const env = getEnv().unifiedData;
  try { return mappingSchema.parse(JSON.parse(env.mappingJson ?? await readFile(resolve(env.mappingFile), "utf8"))); }
  catch { throw new UnifiedDataError("INVALID_ACCOUNT_MAPPING"); }
}

/** Independent private metric directory. A failed partition never replaces its previous version. */
export class UnifiedSnapshotStore {
  private readonly files: FileRecordStore;
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); this.files = new FileRecordStore(this.root); }
  private prefix(s: UnifiedScope) { return `${s.brand}/${s.platform}/${s.accountId}`; }
  async catalog(s: UnifiedScope): Promise<ApiCatalog | null> {
    const value = await this.files.get(`${this.prefix(s)}/catalog`);
    if (value === null) return null;
    const parsed = catalogSchema.safeParse(value);
    if (!parsed.success || !sameScope(parsed.data.scope, s) || parsed.data.account.platform !== s.platform || parsed.data.account.account_id !== s.accountId || parsed.data.account.currency !== s.currency || parsed.data.campaigns.some(c => c.platform !== s.platform || c.account_id !== s.accountId)) throw new UnifiedDataError("INVALID_SAVED_CATALOG");
    return parsed.data;
  }
  async saveCatalog(value: ApiCatalog) { await this.files.set(`${this.prefix(value.scope)}/catalog`, catalogSchema.parse(value)); }
  async partition(s: UnifiedScope, date: string, granularity: "daily" | "hourly"): Promise<ApiPartition | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UnifiedDataError("INVALID_DATE");
    const value = await this.files.get(`${this.prefix(s)}/${granularity}/${date}`);
    if (value === null) return null;
    const parsed = partitionSchema.safeParse(value);
    if (!parsed.success || parsed.data.date !== date || parsed.data.granularity !== granularity || !sameScope(parsed.data.scope, s) || parsed.data.rows.some(r => r.account_id !== s.accountId || r.platform !== s.platform || r.currency !== s.currency || r.date !== date || (granularity === "daily") !== (r.hour === null))) throw new UnifiedDataError("INVALID_SAVED_PARTITION");
    return parsed.data;
  }
  async savePartition(value: ApiPartition) { await this.files.set(`${this.prefix(value.scope)}/${value.granularity}/${value.date}`, partitionSchema.parse(value)); }
  async attempt(s: UnifiedScope, granularity: "daily" | "hourly"): Promise<SyncAttempt | null> {
    const value = await this.files.get(`${this.prefix(s)}/attempt-${granularity}`);
    if (value === null) return null;
    const parsed = attemptSchema.safeParse(value);
    if (!parsed.success) throw new UnifiedDataError("INVALID_SAVED_ATTEMPT");
    return parsed.data;
  }
  async saveAttempt(s: UnifiedScope, granularity: "daily" | "hourly", attempt: SyncAttempt) { await this.files.set(`${this.prefix(s)}/attempt-${granularity}`, attemptSchema.parse(attempt)); }
  async lock(): Promise<() => Promise<void>> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = join(this.root, ".sync-lock");
    try { await mkdir(lock, { mode: 0o700 }); } catch { throw new UnifiedDataError("SYNC_LOCKED"); }
    return async () => { await rm(lock, { recursive: true, force: true }); };
  }
}
