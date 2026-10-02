import "server-only";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { createHash } from "node:crypto";
import { googleDomainsSchema, type GoogleDomainConfig } from "@/lib/domains/config";
import { FileRecordStore } from "@/lib/records/store";
import { attemptSchema, catalogSchema, mappingSchema, partitionSchema, sameScope, UnifiedDataError, type ApiCatalog, type ApiPartition, type SyncAttempt, type UnifiedMapping, type UnifiedScope } from "./schema";
import { getEnv } from "@/lib/config/env";

function validatedCatalog(value: unknown, expected?: UnifiedScope): ApiCatalog {
  const parsed = catalogSchema.safeParse(value);
  if (!parsed.success) throw new UnifiedDataError("INVALID_SAVED_CATALOG");
  const c = parsed.data, s = expected ?? c.scope;
  if (!sameScope(c.scope, s) || c.account.platform !== s.platform || c.account.account_id !== s.accountId || c.account.currency !== s.currency || c.campaigns.some(r => r.platform !== s.platform || r.account_id !== s.accountId) || new Set(c.campaigns.map(r => r.campaign_id)).size !== c.campaigns.length) throw new UnifiedDataError("INVALID_SAVED_CATALOG");
  return c;
}

function validatedPartition(value: unknown, expected?: UnifiedScope, date?: string, granularity?: "daily" | "hourly"): ApiPartition {
  const parsed = partitionSchema.safeParse(value);
  if (!parsed.success) throw new UnifiedDataError("INVALID_SAVED_PARTITION");
  const p = parsed.data, s = expected ?? p.scope;
  const keys = p.rows.map(r => `${r.date}/${r.hour}/${r.campaign_id}`);
  if ((date !== undefined && p.date !== date) || (granularity !== undefined && p.granularity !== granularity) || !sameScope(p.scope, s) || p.rows.some(r => r.account_id !== s.accountId || r.platform !== s.platform || r.currency !== s.currency || r.date !== p.date || (p.granularity === "daily") !== (r.hour === null)) || new Set(keys).size !== keys.length) throw new UnifiedDataError("INVALID_SAVED_PARTITION");
  return p;
}

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
  async domainConfig(): Promise<GoogleDomainConfig | null> {
    const raw = await this.files.get(".metadata/google-domains");
    if (raw === null) return null;
    const cached = z.object({ config: googleDomainsSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), extractedAt: z.iso.datetime() }).strict().safeParse(raw);
    if (!cached.success || createHash("sha256").update(JSON.stringify(cached.data.config)).digest("hex") !== cached.data.fingerprint) throw new UnifiedDataError("INVALID_DOMAIN_CONFIGURATION");
    return cached.data.config;
  }
  async saveDomainConfig(config: GoogleDomainConfig, extractedAt = new Date().toISOString()): Promise<string> {
    const valid = googleDomainsSchema.parse(config);
    const fingerprint = createHash("sha256").update(JSON.stringify(valid)).digest("hex");
    // Keep the exact configuration used by historical rows, even after the master changes.
    await this.files.set(`.metadata/google-domains-history/${fingerprint}`, { config: valid, fingerprint, extractedAt });
    // Publish only after the exact configuration is durable for reproduction.
    await this.files.set(".metadata/google-domains", { config: valid, fingerprint, extractedAt });
    return fingerprint;
  }
  async catalog(s: UnifiedScope): Promise<ApiCatalog | null> {
    const value = await this.files.get(`${this.prefix(s)}/catalog`);
    if (value === null) return null;
    return validatedCatalog(value, s);
  }
  async saveCatalog(value: ApiCatalog) {
    const valid = validatedCatalog(value);
    await this.files.set(`${this.prefix(valid.scope)}/catalog`, valid);
  }
  async partition(s: UnifiedScope, date: string, granularity: "daily" | "hourly"): Promise<ApiPartition | null> {
    if (!z.iso.date().safeParse(date).success) throw new UnifiedDataError("INVALID_DATE");
    const value = await this.files.get(`${this.prefix(s)}/${granularity}/${date}`);
    if (value === null) return null;
    return validatedPartition(value, s, date, granularity);
  }
  async savePartition(value: ApiPartition) {
    const valid = validatedPartition(value);
    await this.files.set(`${this.prefix(valid.scope)}/${valid.granularity}/${valid.date}`, valid);
  }
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
