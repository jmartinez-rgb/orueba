import type { Metadata } from "next";
import { Eye } from "lucide-react";
import { safeSnapshot } from "@/lib/services/safe";
import { ACCOUNT_RULES, RECOMMENDATIONS, TRIGGER_BY_ANOMALY, type Recommendation } from "@/lib/optimizations/catalog";
import { PLATFORMS } from "@/lib/platforms/registry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { ErrorPanel } from "@/components/monitoring/error-panel";
import { StateMessage } from "@/components/monitoring/states";
import { RecommendationCard, RecommendationsByPlatform } from "@/components/optimizations/recommendations-view";

export const metadata: Metadata = { title: "Optimizaciones" };
export const dynamic = "force-dynamic";

export default async function OptimizationsPage() {
  const res = await safeSnapshot();
  if (!res.ok) return <ErrorPanel message={res.message} technical={res.technical} />;
  const snap = res.snap;
  // Recomendaciones relevantes hoy: cruza las anomalías activas con los disparadores de cada recomendación.
  const active = snap.run.anomalies.filter((a) => !a.groupedUnder);
  const now = new Map<string, { rec: Recommendation; context: string[] }>();
  for (const a of active) {
    const trigger = TRIGGER_BY_ANOMALY[a.type];
    for (const r of RECOMMENDATIONS.filter((x) => x.platform === a.platform && x.triggers.includes(trigger))) {
      const cur = now.get(r.id) ?? { rec: r, context: [] };
      const where = a.level === "campaign" ? (a.campaignName ?? "") : a.level === "account" ? (a.accountName ?? "") : PLATFORMS[a.platform].shortName;
      cur.context.push(`${a.title}${where && a.level !== "platform" ? ` (${where})` : ""}`);
      now.set(r.id, cur);
    }
  }
  const relevant = [...now.values()];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Optimizaciones"
        subtitle="Recomendaciones basadas en la documentación oficial de cada plataforma, cruzadas con lo que detecta hoy el monitoreo. Son guías para revisar: la app no aplica cambios; el equipo decide y ejecuta en cada plataforma."
      />
      {snap.meta.domain && snap.meta.domain.id !== "all" && <p className="rounded-lg border bg-card px-4 py-3 text-sm">Alcance: {snap.meta.domain.name}. Las recomendaciones de este corte solo consideran las cuentas del alcance seleccionado.</p>}
      <p className="flex items-center gap-2 rounded-lg bg-card shadow-(--shadow-control) px-3 py-2 text-xs text-muted-foreground">
        <Eye className="size-4 text-brand-teal" /> Solo lectura: ninguna recomendación se ejecuta automáticamente ni modifica campañas, presupuestos o configuraciones.
      </p>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Para revisar ahora</CardTitle>
            <CardDescription>Relacionadas con las anomalías activas de este corte.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {relevant.length === 0 ? (
            <StateMessage kind="no-alerts" compact title="Sin recomendaciones urgentes" description="No hay anomalías activas que coincidan con una recomendación." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {relevant.map(({ rec, context }) => (
                <RecommendationCard key={rec.id} rec={rec} context={`Hoy: ${[...new Set(context)].slice(0, 2).join(" · ")}${context.length > 2 ? ` y ${context.length - 2} más` : ""}`} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Guía por plataforma</CardTitle>
            <CardDescription>Cada tarjeta enlaza a su fuente oficial. Verificadas en septiembre de 2026: revisa la fuente antes de actuar, las plataformas cambian sus reglas.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <RecommendationsByPlatform recommendations={RECOMMENDATIONS} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Reglas de la cuenta izzi</CardTitle>
            <CardDescription>Aplican a cualquier análisis u optimización.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {ACCOUNT_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
