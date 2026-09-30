import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireSession, hasPermission } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { safeSnapshot } from "@/lib/services/safe";
import { getKickoff } from "@/lib/records/novedades";
import type { PlatformId } from "@/lib/types";
import { addDays } from "@/lib/time/tz";
import { PageHeader } from "@/components/monitoring/page-header";
import { StateMessage } from "@/components/monitoring/states";
import { KickoffWizard, type KickoffCampaign } from "@/components/novedades/kickoff-wizard";

export const metadata: Metadata = { title: "Arranque de mes" };
export const dynamic = "force-dynamic";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export default async function KickoffPage() {
  const session = await requireSession("/novedades/arranque");
  const [ctx, snapRes] = await Promise.all([getAppContext(), safeSnapshot()]);
  const month = ctx.month;
  const monthLabel = MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
  if (!hasPermission(session, "kickoff:write")) {
    return <StateMessage kind="empty" title="Solo administradores y co-administradores" description="El arranque de mes lo confirma un administrador o co-administrador." />;
  }
  if (!snapRes.ok) return <StateMessage kind="error" title={snapRes.message} technical={snapRes.technical} />;
  const snap = snapRes.snap;
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);
  const [current, previous, sheetRows] = await Promise.all([getKickoff(ctx.brand, month), getKickoff(ctx.brand, prevMonth), ctx.source.getBudgets(month).catch(() => [])]);
  const platforms: PlatformId[] = snap.run.platforms;
  const accountName = new Map(snap.catalog.accounts.map((a) => [a.id, a.name]));
  const byCampaign = new Map(snap.run.entities.filter((e) => e.level === "campaign" && e.campaignId).map((e) => [e.campaignId!, e]));
  const known = new Set((current ?? previous)?.items.map((i) => i.campaignId).filter(Boolean) as string[]);
  const campaigns: KickoffCampaign[] = snap.catalog.campaigns
    .filter((c) => platforms.includes(c.platform))
    .filter((c) => c.status === "ACTIVE" || known.has(c.id) || (byCampaign.get(c.id)?.cumulative.spend?.expected ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      platform: c.platform,
      accountName: accountName.get(c.accountId) ?? null,
      statusText: c.statusSource === "platform" ? (c.statusText ?? null) : null,
      spentRecently: c.status === "ACTIVE",
      suggested: c.status === "ACTIVE" ? ("ACTIVE" as const) : ("ENDED" as const),
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
  const sheetBudgets: Partial<Record<PlatformId, number>> = {};
  for (const b of sheetRows) if (b.level === "platform" && b.platform) sheetBudgets[b.platform] = b.amount;
  const initialBudgets = current?.budgets ?? previous?.budgets ?? [];
  const initialItems = current?.items ?? previous?.items.filter((i) => i.key.startsWith("pend:") && !i.startedAt) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/novedades" className="inline-flex w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Novedades
      </Link>
      <PageHeader
        title={`Arranque de ${monthLabel}`}
        subtitle={
          current
            ? `Confirmado por ${current.confirmedBy}. Puedes ajustarlo: cada cambio queda en Novedades.`
            : previous
              ? "Precargado con el arranque del mes anterior: revisa montos y estados antes de confirmar."
              : "Captura los presupuestos del mes y marca qué está activo y qué falta por iniciar."
        }
      />
      <KickoffWizard
        month={month}
        monthLabel={monthLabel}
        platforms={platforms}
        accounts={snap.catalog.accounts.filter((a) => platforms.includes(a.platform)).map((a) => ({ id: a.id, name: a.name, platform: a.platform }))}
        campaigns={campaigns}
        initialBudgets={initialBudgets}
        initialItems={initialItems}
        sheetBudgets={sheetBudgets}
      />
    </div>
  );
}
