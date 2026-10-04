import "server-only";
import { createHash } from "node:crypto";
import type { GoogleDomainConfig } from "@/lib/domains/config";
import { googleDomainsSchema } from "@/lib/domains/config";
import { getRecordStore, type RecordStore } from "@/lib/records/store";
import { absoluteTopAuditSchema } from "./schema";
import { evaluateAbsoluteTop, STALE_PERIOD_WARNING } from "./engine";
import { AbsoluteTopError, type AbsoluteTopAudit, type AbsoluteTopEvaluation } from "./types";

interface CustomerHistory { version: 1; audits: AbsoluteTopAudit[]; latest: AbsoluteTopEvaluation[]; latestAudit: AbsoluteTopAudit | null; configFingerprint?: string }
export interface AbsoluteTopCheckpoint {
  rows: AbsoluteTopEvaluation[];
  latestAudit: AbsoluteTopAudit | null;
  matchesConfig: boolean;
}
/** One customer is one atomic CAS document: extraction history and its counters cannot diverge. */
export class AbsoluteTopStore {
  constructor(private readonly records: RecordStore = getRecordStore()) {}
  private key(customer: string) { if (!/^\d{10}$/.test(customer)) throw new AbsoluteTopError("INVALID_CUSTOMER"); return `absolute-top/izzi/${customer}`; }
  async ingest(input: AbsoluteTopAudit, inputConfig: GoogleDomainConfig, now = new Date()): Promise<AbsoluteTopEvaluation[]> {
    const parsed = absoluteTopAuditSchema.safeParse(input), master = googleDomainsSchema.safeParse(inputConfig);
    if (!parsed.success || !master.success) throw new AbsoluteTopError("INVALID_AUDIT");
    const audit = parsed.data, config = master.data;
    if (Date.parse(audit.observedAt) > now.getTime() + 60000) throw new AbsoluteTopError("FUTURE_AUDIT");
    const cutoff = now.getTime() - config.absoluteTop.retentionDays * 86400000;
    if (Date.parse(audit.observedAt) < cutoff) throw new AbsoluteTopError("EXPIRED_AUDIT");
    const state = await this.records.update<CustomerHistory>(this.key(audit.customerId), current => {
      const old = current ?? { version: 1, audits: [], latest: [], latestAudit: null };
      const duplicate = old.audits.find(item => item.auditId === audit.auditId);
      if (duplicate) { if (JSON.stringify(duplicate) !== JSON.stringify(audit)) throw new AbsoluteTopError("AUDIT_ID_CONFLICT"); return old; }
      const audits = [...old.audits.filter(item => Date.parse(item.observedAt) >= cutoff), audit].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.auditId.localeCompare(b.auditId));
      if (audits.length > 5000) throw new AbsoluteTopError("HISTORY_CAPACITY");
      const later = !old.latestAudit || Date.parse(audit.observedAt) > Date.parse(old.latestAudit.observedAt) || (Date.parse(audit.observedAt) === Date.parse(old.latestAudit.observedAt) && audit.auditId > old.latestAudit.auditId);
      const evaluated = later ? evaluateAbsoluteTop(audit, audits, config, old.latest) : old.latest;
      // A later extraction of a window older than the checkpoint (backfill) is history only: it never
      // replaces the current reading with a stale, insufficient one.
      const newer = later && !(evaluated.length > 0 && evaluated.every(row => row.warnings.includes(STALE_PERIOD_WARNING)));
      return { version: 1, audits, latest: newer ? evaluated : old.latest, latestAudit: newer ? audit : old.latestAudit, configFingerprint: newer ? createHash("sha256").update(JSON.stringify(config)).digest("hex") : old.configFingerprint };
    });
    if (!state) throw new AbsoluteTopError("STORE_UNCONFIRMED");
    return state.latest;
  }
  async matchesConfig(customer: string, config: GoogleDomainConfig): Promise<boolean> { const state = await this.records.get<CustomerHistory>(this.key(customer)); return state?.configFingerprint === createHash("sha256").update(JSON.stringify(googleDomainsSchema.parse(config))).digest("hex"); }
  /** One atomic read prevents mixing rows, audit IDs and policy receipts from concurrent ingestions. */
  async checkpoint(customer: string, config: GoogleDomainConfig): Promise<AbsoluteTopCheckpoint> {
    const fingerprint = createHash("sha256").update(JSON.stringify(googleDomainsSchema.parse(config))).digest("hex");
    const state = await this.records.get<CustomerHistory>(this.key(customer));
    return { rows: state?.latest ?? [], latestAudit: state?.latestAudit ?? null, matchesConfig: state?.configFingerprint === fingerprint };
  }
  async customers(): Promise<string[]> { return (await this.records.list("absolute-top/izzi/")).map(key => key.slice("absolute-top/izzi/".length)).filter(customer => /^\d{10}$/.test(customer)); }
  async latest(customer: string): Promise<AbsoluteTopEvaluation[]> { return (await this.records.get<CustomerHistory>(this.key(customer)))?.latest ?? []; }
  async latestAudit(customer: string): Promise<AbsoluteTopAudit | null> { return (await this.records.get<CustomerHistory>(this.key(customer)))?.latestAudit ?? null; }
  async history(customer: string): Promise<AbsoluteTopAudit[]> { return (await this.records.get<CustomerHistory>(this.key(customer)))?.audits ?? []; }
}
