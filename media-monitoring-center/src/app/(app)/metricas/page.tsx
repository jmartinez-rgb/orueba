import type { Metadata } from "next";
import { PLATFORM_IDS } from "@/lib/types";
import { safeSnapshot } from "@/lib/services/safe";
import { platformCard } from "@/lib/services/view-models";
import { evaluateTargets } from "@/lib/monitoring/targets";
import { METRICS, OBJECTIVE_KPI, OBJECTIVE_LABEL } from "@/lib/metrics";
import { PLATFORMS } from "@/lib/platforms/registry";
import { fmtMetric } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/monitoring/page-header";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { MetricPicker } from "@/components/monitoring/metric-picker";
import { DeltaText, PlatformMark } from "@/components/monitoring/status";
import { ConfidenceMeter } from "@/components/monitoring/confidence-meter";
import { FixedTargetsEditor } from "@/components/metrics/fixed-targets-editor";

export const metadata: Metadata = { title: "Métricas" };
export const dynamic = "force-dynamic";

const DEFINITIONS: Array<{ metric: keyof typeof METRICS; formula: string; note: string }> = [
  { metric: "spend", formula: "Suma del costo reportado (MXN; USD × tasa del mes)", note: "Sube o baja: ambas direcciones se vigilan." },
  { metric: "conversions", formula: "Suma de conversiones de la plataforma", note: "NULL si la plataforma no la reporta (no es cero)." },
  { metric: "sales", formula: "Google: MCC_Offline_Purchase · Meta: Compras Offline Web (Inbound)", note: "En Meta, las campañas CAPI WhatsApp se miden con On-Facebook Purchase y no se mezclan." },
  { metric: "leads", formula: "Google: MCC_Offline_Lead_Contact · formularios / registros", note: "Solo eventos offline válidos en Google." },
  { metric: "whatsapp", formula: "Conversaciones iniciadas por WhatsApp", note: "Métrica secundaria: no define conclusiones de tests." },
  { metric: "purchases", formula: "On-Facebook Purchase (campañas CAPI WhatsApp)", note: "Universo separado de Compras Offline Web." },
  { metric: "cpa", formula: "SUMA(costo) ÷ SUMA(conversiones)", note: "Siempre desde totales: nunca se promedian CPAs." },
  { metric: "cpl", formula: "SUMA(costo) ÷ SUMA(leads)", note: "Desde totales." },
  { metric: "cpr", formula: "SUMA(costo) ÷ SUMA(resultado del objetivo)", note: "El resultado depende del objetivo de la campaña o de la métrica monitoreada." },
  { metric: "ctr", formula: "SUMA(clics) ÷ SUMA(impresiones)", note: "Métrica secundaria." },
  { metric: "cpc", formula: "SUMA(costo) ÷ SUMA(clics)", note: "" },
  { metric: "cpm", formula: "SUMA(costo) ÷ SUMA(impresiones) × 1,000", note: "Plataformas de alcance (Spotify) se evalúan con CPM." },
  { metric: "roas", formula: "SUMA(ingresos) ÷ SUMA(costo)", note: "Solo si la plataforma reporta ingresos." },
];

export default async function MetricsPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  const canEdit = snap.meta.permissions.includes("settings:write");
  const attention = snap.settings.thresholds.attention;
  const checks = evaluateTargets(snap.settings, snap.run.entities);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Métricas"
        subtitle="Qué métrica se monitorea en cada plataforma (define su semáforo junto con el gasto), qué métricas se muestran siempre y objetivos fijos opcionales. Solo cambian el monitoreo: nada se modifica en las plataformas."
      />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Métrica monitoreada por plataforma</CardTitle>
            <CardDescription>También se cambia desde cada tarjeta del Overview. Las campañas conservan el KPI de su objetivo.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plataforma</TableHead>
                <TableHead>Métrica monitoreada</TableHead>
                <TableHead className="text-right">Hoy</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Desv.</TableHead>
                <TableHead>Métricas fijas</TableHead>
                <TableHead>Confianza</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PLATFORM_IDS.map((p) => {
                const vm = platformCard(snap, p);
                return (
                  <TableRow key={p}>
                    <TableCell>
                      <span className="flex items-center gap-2 text-xs font-medium">
                        <PlatformMark platform={p} className="size-5 text-[9px]" /> {PLATFORMS[p].name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Por defecto: {OBJECTIVE_KPI[PLATFORMS[p].platformObjective].resultLabel} ({OBJECTIVE_LABEL[PLATFORMS[p].platformObjective]})</span>
                    </TableCell>
                    <TableCell>
                      <MetricPicker platform={p} primary={vm.primaryMetric} choices={vm.metricChoices} pinned={vm.pinnedIds} canEdit={canEdit} />
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">{fmtMetric(vm.result.metric, vm.result.current)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{fmtMetric(vm.result.metric, vm.result.expected)}</TableCell>
                    <TableCell className="text-right text-xs">
                      <DeltaText value={vm.result.deviation} bad={vm.result.lagging ? "none" : "down"} attention={attention} />
                    </TableCell>
                    <TableCell className="text-xs">{vm.pinned.length ? vm.pinned.map((m) => m.label).join(", ") : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <ConfidenceMeter confidence={vm.confidence} compact />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Métricas y objetivos fijos</CardTitle>
            <CardDescription>
              Valores que el equipo quiere vigilar siempre (p. ej. CPA máximo o conversiones mínimas al día). Las métricas que se suman se comparan con la proyección del día según la curva horaria;
              las de costo o tasa, con su valor acumulado. Se muestran en el Overview y en cada plataforma.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <FixedTargetsEditor targets={snap.settings.fixedTargets} checks={checks} accounts={snap.catalog.accounts.map((a) => ({ id: a.id, name: a.name, platform: a.platform }))} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Catálogo de métricas</CardTitle>
            <CardDescription>Cómo se calcula cada métrica. Las derivadas siempre salen de totales; un valor NULL significa “no hay dato”, nunca cero.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Métrica</TableHead>
                <TableHead>Cálculo</TableHead>
                <TableHead>Dirección mala</TableHead>
                <TableHead>Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEFINITIONS.map((d) => (
                <TableRow key={d.metric}>
                  <TableCell className="text-xs font-semibold">{METRICS[d.metric].label}</TableCell>
                  <TableCell className="text-xs">{d.formula}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{METRICS[d.metric].bad === "down" ? "Si baja" : METRICS[d.metric].bad === "up" ? "Si sube" : "Ambas"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.note || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
