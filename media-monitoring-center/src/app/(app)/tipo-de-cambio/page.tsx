import type { Metadata } from "next";
import { hasPermission } from "@/lib/auth/session";
import { getAppContext } from "@/lib/services/context";
import { businessDate } from "@/lib/time/tz";
import { fxMonths } from "@/lib/data/fx-months";
import { PageHeader } from "@/components/monitoring/page-header";
import { CurrencySettings } from "@/components/settings/currency-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Tipo de cambio" };
export const dynamic = "force-dynamic";

export default async function ExchangeRatePage() {
  const ctx = await getAppContext();
  const canEdit = hasPermission(ctx.session, "settings:write");
  const [catalog, rates] = await Promise.all([ctx.source.original.getCatalog(), ctx.source.original.getFxRates()]);
  const sourceRates = Object.fromEntries(rates.map(r => [r.month, r.rate]));
  const months = fxMonths(businessDate(ctx.source.now(), ctx.settings.timezone), ctx.settings.currency.rates, sourceRates);
  const usd = catalog.accounts.filter(a => (ctx.settings.currency.accountCurrency[a.id] ?? a.currency) === "USD").length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Tipo de cambio" subtitle="Captura la tasa mensual para convertir los costos en USD a MXN. Las tasas se comparten entre izzi y Sky; cada costo usa el mes de su fecha." />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tasas mensuales USD → MXN</CardTitle>
            <CardDescription>{usd} cuentas en USD en la marca seleccionada. {canEdit ? "Los administradores pueden guardar las tasas; los cambios se registran en la bitácora de actividad." : "Tu acceso es de consulta. Un administrador debe capturar o cambiar las tasas."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CurrencySettings months={months} settingsRates={ctx.settings.currency.rates} sourceRates={sourceRates} accounts={catalog.accounts.map(a => ({ id: a.id, name: a.name, platform: a.platform, sourceCurrency: a.currency }))} accountCurrency={ctx.settings.currency.accountCurrency} canEdit={canEdit} editAccountCurrency={false} />
        </CardContent>
      </Card>
    </div>
  );
}
