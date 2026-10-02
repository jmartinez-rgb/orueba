import "server-only";
import type { PlatformId } from "@/lib/types";
import { PLATFORMS } from "@/lib/platforms/registry";
import { createNovedad, getKickoff, linkKickoffCampaigns, markKickoffStarted, saveKickoff, type KickoffBudget, type KickoffItem, type MonthKickoff } from "@/lib/records/novedades";
import { addDays, businessDate } from "@/lib/time/tz";
import { logger } from "@/lib/logging/logger";
import type { AppContext } from "./context";
import type { Snapshot } from "./snapshot";

export interface PendingStart {
  key: string;
  name: string;
  platform: PlatformId;
  accountName: string | null;
  expectedStart: string | null;
  overdue: boolean;
}

export interface KickoffStatus {
  month: string;
  today: string;
  confirmed: boolean;
  /** Si el aviso obligatorio debe bloquear (el primer mes, a pocos días de terminar, no bloquea). */
  required: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Plataformas monitoreadas sin presupuesto del mes (ni en la hoja, ni en la app, ni en el arranque). */
  missingBudgets: PlatformId[];
  pending: PendingStart[];
  /** Pendientes que se detectaron iniciando en esta consulta. */
  justStarted: string[];
}

const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const identityOf = ({ name, platform, accountName, campaignId }: KickoffItem) => ({ name, platform, accountName, campaignId });

/**
 * Estado del arranque del mes para el aviso obligatorio y el recordatorio diario. De paso detecta
 * las campañas pendientes que ya empezaron a gastar (por ID o por nombre) y las marca como iniciadas.
 */
export async function kickoffStatus(ctx: AppContext, snap: Snapshot | null): Promise<KickoffStatus> {
  const today = snap?.run.businessDate ?? businessDate(ctx.source.now(), ctx.settings.timezone);
  const month = today.slice(0, 7);
  let kickoff = ctx.kickoff && ctx.kickoff.month === month ? ctx.kickoff : await getKickoff(ctx.brand, month).catch(() => null);
  const justStarted: string[] = [];

  if (kickoff && snap) {
    const approvedBy = kickoff.confirmedBy;
    const spendToday = new Map<string, number>();
    for (const e of snap.run.entities) if (e.level === "campaign" && e.campaignId) spendToday.set(e.campaignId, e.cumulative.spend?.current ?? 0);
    const started: Array<{ key: string; at: string; campaignId: string; expected: ReturnType<typeof identityOf> }> = [];
    const links: Array<{ key: string; campaignId: string; expected: ReturnType<typeof identityOf> }> = [];
    for (const it of kickoff.items) {
      if (it.state !== "PENDING" || it.startedAt) continue;
      // Una campaña capturada a mano (aún sin ID) se busca por nombre en el catálogo de la hoja.
      let campaignId = it.campaignId;
      if (!campaignId) {
        const match = snap.catalog.campaigns.find((c) => c.platform === it.platform && (norm(c.name) === norm(it.name) || norm(c.name).includes(norm(it.name))));
        if (match) {
          campaignId = match.id;
          links.push({ key: it.key, campaignId, expected: identityOf(it) });
        }
      }
      if (campaignId && (spendToday.get(campaignId) ?? 0) > 0) started.push({ key: it.key, at: new Date().toISOString(), campaignId, expected: { ...identityOf(it), campaignId } });
    }
    if (links.length) kickoff = await linkKickoffCampaigns(ctx.brand, month, links, "Monitoreo automático");
    if (started.length) {
      const done = await markKickoffStarted(ctx.brand, month, started, "Monitoreo automático");
      for (const it of done) {
        justStarted.push(it.name);
        await createNovedad(
          {
            kind: "ACTIVACION",
            title: `Inició: ${it.name}`,
            detail: `Estaba pendiente por iniciar en el arranque de ${month}${it.expectedStart ? ` (fecha esperada ${it.expectedStart})` : ""}. Se detectó gasto el ${today}.`,
            platform: it.platform,
            accountId: null,
            accountName: it.accountName,
            campaignId: it.campaignId,
            campaignName: it.name,
            approvedBy,
            approvalChannel: "OTRO",
            approvalRef: `Arranque de ${month}`,
            effectiveFrom: today,
            effectiveUntil: null,
            budget: null,
            expectedChange: null,
            includesFullStop: false,
            silenceAlerts: false,
            incidentId: null,
            alertFingerprint: null,
          },
          "Monitoreo automático",
          ctx.brand,
        ).catch((err) => logger.warn("kickoff.start_novedad_failed", { error: err }));
      }
      kickoff = await getKickoff(ctx.brand, month);
    }
  }

  const budgeted = new Set<PlatformId>();
  for (const b of kickoff?.budgets ?? []) budgeted.add(b.platform);
  for (const b of await ctx.source.getBudgets(month).catch(() => [])) if (b.platform) budgeted.add(b.platform);
  const overrides = await ctx.store.getOverrides().catch(() => null);
  for (const b of overrides?.budgets ?? []) if (b.month === month && b.platform) budgeted.add(b.platform);
  const monitored = ctx.settings.monitoredPlatforms.filter((p) => ctx.brandPlatforms.length === 0 || ctx.brandPlatforms.includes(p));
  // Primer mes con la función (sin arranque del mes anterior) y a pocos días de cerrar: no se bloquea,
  // la obligación empieza el día 1 del mes siguiente.
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);
  const firstMonthGrace = !kickoff && Number(today.slice(8, 10)) >= 25 && !(await getKickoff(ctx.brand, prevMonth).catch(() => null));

  return {
    month,
    today,
    confirmed: Boolean(kickoff),
    required: !kickoff && !firstMonthGrace,
    confirmedBy: kickoff?.confirmedBy ?? null,
    confirmedAt: kickoff?.confirmedAt ?? null,
    missingBudgets: monitored.filter((p) => !budgeted.has(p)),
    pending: (kickoff?.items ?? [])
      .filter((i) => i.state === "PENDING" && !i.startedAt)
      .map((i) => ({ key: i.key, name: i.name, platform: i.platform, accountName: i.accountName, expectedStart: i.expectedStart, overdue: Boolean(i.expectedStart && i.expectedStart < today) })),
    justStarted,
  };
}

/** Guarda el arranque del mes y lo deja en Novedades (quién lo confirmó y qué quedó). */
export async function confirmKickoff(ctx: AppContext, input: { month: string; budgets: KickoffBudget[]; items: KickoffItem[] }, by: string): Promise<MonthKickoff> {
  const prev = await getKickoff(ctx.brand, input.month).catch(() => null);
  const now = new Date().toISOString();
  const k: MonthKickoff = {
    month: input.month,
    brand: ctx.brand,
    confirmedAt: prev?.confirmedAt ?? now,
    confirmedBy: prev?.confirmedBy ?? by,
    budgets: input.budgets,
    // Conserva lo detectado (inicio real) aunque se vuelva a guardar el arranque.
    items: input.items.map((it) => ({ ...it, startedAt: it.startedAt ?? prev?.items.find((p) => p.key === it.key)?.startedAt ?? null })),
    updatedAt: now,
    updatedBy: by,
  };
  const saved = await saveKickoff(k);
  const total = input.budgets.reduce((a, b) => a + b.amount, 0);
  const byPlatform = [...new Set(input.budgets.map((b) => b.platform))]
    .map((p) => `${PLATFORMS[p].shortName} ${Math.round(input.budgets.filter((b) => b.platform === p && !b.accountId).reduce((a, b) => a + b.amount, 0) || input.budgets.filter((b) => b.platform === p).reduce((a, b) => a + b.amount, 0)).toLocaleString("es-MX")}`)
    .join(" · ");
  const count = (s: KickoffItem["state"]) => input.items.filter((i) => i.state === s).length;
  await createNovedad(
    {
      kind: "ARRANQUE",
      title: `${prev ? "Arranque actualizado" : "Arranque de mes"}: ${input.month}`,
      detail: `Presupuestos: ${byPlatform || "—"} (total ${Math.round(total).toLocaleString("es-MX")} MXN). Campañas: ${count("ACTIVE")} activas, ${count("PENDING")} pendientes por iniciar, ${count("ENDED")} no corren este mes.`,
      platform: null,
      accountId: null,
      accountName: null,
      campaignId: null,
      campaignName: null,
      approvedBy: by,
      approvalChannel: "OTRO",
      approvalRef: null,
      effectiveFrom: `${input.month}-01`,
      effectiveUntil: null,
      budget: null,
      expectedChange: null,
      includesFullStop: false,
      silenceAlerts: false,
      incidentId: null,
      alertFingerprint: null,
    },
    by,
    ctx.brand,
  );
  return saved;
}
