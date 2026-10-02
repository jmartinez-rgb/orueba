import type { Metadata } from "next";
import { hasPermission } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { maskAddress } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { PageHeader } from "@/components/monitoring/page-header";
import { SettingsForm } from "@/components/monitoring/settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencySettings } from "@/components/settings/currency-settings";
import { ClassifierEditor } from "@/components/settings/classifier-editor";
import { businessDate } from "@/lib/time/tz";
import { fxMonths } from "@/lib/data/fx-months";

export const metadata: Metadata = { title: "Configuración" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getAppContext();
  const canEdit = hasPermission(ctx.session, "settings:write");
  const catalog = await ctx.source.getCatalog();
  const [sourceCatalog, sourceRates] = await Promise.all([ctx.source.original.getCatalog(), ctx.source.original.getFxRates().catch(() => [])]);
  const today = businessDate(ctx.source.now(), ctx.settings.timezone);
  const months = fxMonths(today, ctx.settings.currency.rates, Object.fromEntries(sourceRates.map(r => [r.month, r.rate])));
  const settings = canEdit ? ctx.settings : { ...ctx.settings, recipients: ctx.settings.recipients.map((r) => ({ ...r, address: maskAddress(r.address) })) };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Configuración"
        subtitle={`Los cambios se guardan en el almacén configurado y aplican para todo el equipo. Solo cambian el monitoreo: nada se modifica en las plataformas. Rol actual: ${ROLE_LABEL[ctx.session.role]}${ctx.session.mode === "open" ? " (acceso abierto: cámbialo desde el menú de usuario)" : ""}.`}
      />
      <SettingsForm revision={ctx.settingsRevision} initial={settings} canEdit={canEdit} mode={ctx.mode} campaigns={catalog.campaigns.map((c) => ({ id: c.id, name: c.name, platform: c.platform, objective: c.objective }))} />
      <Card id="moneda" className="scroll-mt-20">
        <CardHeader>
          <div>
            <CardTitle>Moneda y tipo de cambio</CardTitle>
            <CardDescription>Hay cuentas en MXN y en USD. Todo se reporta en MXN con la tasa de cada mes (la tasa cambia cada mes).</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CurrencySettings
            months={months}
            settingsRates={ctx.settings.currency.rates}
            sourceRates={Object.fromEntries(sourceRates.map((r) => [r.month, r.rate]))}
            accounts={sourceCatalog.accounts.map((a) => ({ id: a.id, name: a.name, platform: a.platform, sourceCurrency: a.currency }))}
            accountCurrency={ctx.settings.currency.accountCurrency}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
      <Card id="clasificadores" className="scroll-mt-20">
        <CardHeader>
          <div>
            <CardTitle>Clasificación de estrategias</CardTitle>
            <CardDescription>Réplica editable de las fórmulas de la hoja (Meta por nombre de campaña y objetivo; Google por nombre y tipo de campaña). Se usa en Comparativas y en cada plataforma.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ClassifierEditor initial={ctx.settings.classifiers} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
