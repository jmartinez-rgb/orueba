import type { BudgetRow, Catalog, DailyRow, EntityLevel, FreshnessRecord, HourlyRow, PlatformId } from "@/lib/types";
import { BASE_METRICS, PLATFORM_IDS } from "@/lib/types";
import { addMetrics } from "@/lib/metrics";
import { brandOfAccount, brandOfCampaign, DEFAULT_BRAND, type BrandId } from "@/lib/brands";
import type { DailyQuery, HourlyQuery, MonitoringDataSource } from "./source";

/**
 * Vista de una sola marca (izzi o Sky) sobre la fuente completa. La hoja, el mock o BigQuery
 * traen las cuentas de ambas marcas; esta capa deja solo las de la marca elegida:
 * - Cuentas: por su nombre. Una cuenta mixta ("izzi - Sky Social") aparece en las dos marcas,
 *   cada una con sus campañas.
 * - Filas por campaña: por la marca de su campaña. Los totales por cuenta y plataforma se
 *   vuelven a sumar solo con las campañas de la marca (a menos que la plataforma sea toda de
 *   la marca, en cuyo caso se consulta directo).
 * - Presupuestos por plataforma o totales sin marca: se asignan a izzi (a Sky, por cuenta o campaña).
 */

interface Scope {
  catalog: Catalog;
  accounts: Set<string>;
  campaigns: Set<string>;
  /** Plataformas con al menos una cuenta de la marca. */
  platforms: PlatformId[];
  /** Plataformas donde todo el catálogo es de la marca (se consultan sin filtrar). */
  whole: Set<PlatformId>;
  /** Marca por nombre de cada cuenta del catálogo completo (para campañas fuera del catálogo). */
  accountBrand: Map<string, BrandId | null>;
  /** Todas las campañas del catálogo completo (de cualquier marca). */
  known: Set<string>;
}

function aggregate<T extends HourlyRow | DailyRow>(rows: T[], level: EntityLevel, strict = false): T[] {
  if (level === "campaign") return rows;
  const map = new Map<string, T>();
  for (const r of rows) {
    const accountId = level === "account" ? r.accountId : null;
    const key = `${r.date}|${"hour" in r ? r.hour : ""}|${r.platform}|${accountId}`;
    const cur = map.get(key);
    if (cur) {
      if (strict) for (const m of BASE_METRICS) cur.metrics[m] = cur.metrics[m] === null || r.metrics[m] === null ? null : cur.metrics[m]! + r.metrics[m]!;
      else addMetrics(cur.metrics, r.metrics);
    }
    else map.set(key, { ...r, accountId, campaignId: null, metrics: { ...r.metrics } });
  }
  return [...map.values()];
}

export class BrandScopedSource implements MonitoringDataSource {
  readonly kind: MonitoringDataSource["kind"];
  private scopePromise: Promise<Scope> | null = null;

  constructor(
    readonly inner: MonitoringDataSource,
    readonly brand: BrandId,
  ) {
    this.kind = inner.kind;
  }

  now() {
    return this.inner.now();
  }

  private scope(): Promise<Scope> {
    this.scopePromise ??= this.inner.getCatalog().then((full) => {
      const accountById = new Map(full.accounts.map((a) => [a.id, a]));
      const accountBrand = new Map(full.accounts.map((a) => [a.id, a.brand ?? brandOfAccount(a.name)]));
      const campaigns = full.campaigns.filter((c) => (accountById.get(c.accountId)?.brand ?? brandOfCampaign(accountById.get(c.accountId)?.name, c.name)) === this.brand);
      const withCampaigns = new Set(campaigns.map((c) => c.accountId));
      const hasAnyCampaign = new Set(full.campaigns.map((c) => c.accountId));
      const accounts = full.accounts.filter((a) => {
        const b = accountBrand.get(a.id);
        if (b) return b === this.brand;
        // Cuenta mixta o sin marca en el nombre: entra con las campañas de la marca.
        return withCampaigns.has(a.id) || (!hasAnyCampaign.has(a.id) && this.brand === DEFAULT_BRAND);
      });
      const accountIds = new Set(accounts.map((a) => a.id));
      const campaignIds = new Set(campaigns.map((c) => c.id));
      const platforms = PLATFORM_IDS.filter((p) => accounts.some((a) => a.platform === p));
      const whole = new Set(
        platforms.filter((p) => full.accounts.every((a) => a.platform !== p || accountIds.has(a.id)) && full.campaigns.every((c) => c.platform !== p || campaignIds.has(c.id))),
      );
      return {
        catalog: { accounts, campaigns: campaigns.filter((c) => accountIds.has(c.accountId)) },
        accounts: accountIds,
        campaigns: campaignIds,
        platforms,
        whole,
        accountBrand,
        known: new Set(full.campaigns.map((c) => c.id)),
      };
    });
    return this.scopePromise;
  }

  /** Plataformas en las que la marca tiene cuentas. */
  async platforms(): Promise<PlatformId[]> {
    return (await this.scope()).platforms;
  }

  async getCatalog(): Promise<Catalog> {
    const s = await this.scope();
    return { accounts: s.catalog.accounts.map((a) => ({ ...a })), campaigns: s.catalog.campaigns.map((c) => ({ ...c })) };
  }

  private keepRow(s: Scope, r: { accountId: string | null; campaignId: string | null }): boolean {
    if (r.campaignId && s.campaigns.has(r.campaignId)) return true;
    if (!r.accountId || !s.accounts.has(r.accountId)) return false;
    // Campaña que no está en el catálogo: decide la marca del nombre de la cuenta.
    if (r.campaignId) return !s.known.has(r.campaignId) && (s.accountBrand.get(r.accountId) ?? DEFAULT_BRAND) === this.brand;
    return true;
  }

  /** Divide la consulta: plataformas completas de la marca van directo; las demás se filtran por campaña. */
  private async split(requested: PlatformId[] | undefined): Promise<{ s: Scope; direct: PlatformId[]; filtered: PlatformId[] }> {
    const s = await this.scope();
    const wanted = s.platforms.filter((p) => !requested?.length || requested.includes(p));
    return { s, direct: wanted.filter((p) => s.whole.has(p)), filtered: wanted.filter((p) => !s.whole.has(p)) };
  }

  async getHourly(q: HourlyQuery): Promise<HourlyRow[]> {
    const { s, direct, filtered } = await this.split(q.platforms);
    const [a, b] = await Promise.all([
      direct.length ? this.inner.getHourly({ ...q, platforms: direct }) : Promise.resolve([]),
      filtered.length ? this.inner.getHourly({ ...q, level: "campaign", platforms: filtered }) : Promise.resolve([]),
    ]);
    return [...a, ...aggregate(b.filter((r) => this.keepRow(s, r)), q.level, this.kind === "unified")];
  }

  async getDaily(q: DailyQuery): Promise<DailyRow[]> {
    const { s, direct, filtered } = await this.split(q.platforms);
    const [a, b] = await Promise.all([
      direct.length ? this.inner.getDaily({ ...q, platforms: direct }) : Promise.resolve([]),
      filtered.length ? this.inner.getDaily({ ...q, level: "campaign", platforms: filtered }) : Promise.resolve([]),
    ]);
    return [...a, ...aggregate(b.filter((r) => this.keepRow(s, r)), q.level, this.kind === "unified")];
  }

  async getBudgets(month: string): Promise<BudgetRow[]> {
    const s = await this.scope();
    const rows = await this.inner.getBudgets(month);
    return rows.filter((b) => {
      if (b.level === "campaign") return b.campaignId !== null && s.campaigns.has(b.campaignId);
      if (b.level === "account") return b.accountId !== null && s.accounts.has(b.accountId) && (s.accountBrand.get(b.accountId) ?? this.brand) === this.brand;
      if (b.level === "platform") return this.brand === DEFAULT_BRAND && b.platform !== null && s.platforms.includes(b.platform);
      return this.brand === DEFAULT_BRAND;
    });
  }

  async getFreshness(asOf: Date): Promise<FreshnessRecord[]> {
    const s = await this.scope();
    const rows = await this.inner.getFreshness(asOf);
    return rows.filter((r) => (r.accountId === null ? s.platforms.includes(r.platform) : s.accounts.has(r.accountId)));
  }

  async getSyncLog(limit: number) {
    const s = await this.scope();
    return (await this.inner.getSyncLog(limit)).filter((r) => !(PLATFORM_IDS as string[]).includes(r.platform) || s.platforms.includes(r.platform as PlatformId));
  }

  async getDataQuality(date: string) {
    const s = await this.scope();
    return (await this.inner.getDataQuality(date)).filter((r) => s.platforms.includes(r.platform));
  }

  async getExecutionControl(asOf: Date) {
    const s = await this.scope();
    return (await this.inner.getExecutionControl(asOf)).filter((r) => r.platform === null || !(PLATFORM_IDS as string[]).includes(r.platform) || s.platforms.includes(r.platform as PlatformId));
  }

  getFxRates() {
    return this.inner.getFxRates();
  }

  async estimatedHourly(date: string): Promise<PlatformId[]> {
    return (await this.inner.estimatedHourly?.(date)) ?? [];
  }
}
