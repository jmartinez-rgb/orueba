import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { requireSession, hasPermission } from "@/lib/auth/session";
import { listFeedback, listFeedbackBy, OPEN_FEEDBACK_STATUSES } from "@/lib/records/feedback";
import { baseSettings } from "@/lib/services/context";
import { NAV_ITEMS } from "@/components/layout/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { FeedbackForm, FeedbackList } from "@/components/feedback/feedback-center";

export const metadata: Metadata = { title: "Bugs y sugerencias" };
export const dynamic = "force-dynamic";

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const session = await requireSession("/sugerencias");
  const sp = await searchParams;
  const manage = hasPermission(session, "feedback:manage");
  const tz = baseSettings().timezone;
  const [mine, all] = await Promise.all([listFeedbackBy(session.user.id), manage ? listFeedback() : Promise.resolve([])]);
  const sections = NAV_ITEMS.filter((i) => i.href !== "/sugerencias").map((i) => ({ href: i.href, label: i.label }));
  const sectionLabel = Object.fromEntries(sections.map((s) => [s.href, s.label]));
  const from = sp.from && /^\/[a-z0-9/_-]*$/i.test(sp.from) ? (sections.find((s) => s.href !== "/" && sp.from!.startsWith(s.href))?.href ?? (sp.from === "/" ? "/" : null)) : null;
  const pending = all.filter((f) => OPEN_FEEDBACK_STATUSES.includes(f.status));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Bugs y sugerencias" subtitle="¿Algo no funciona o se te ocurre una mejora? Envíalo aquí. Solo el administrador lo recibe y le da seguimiento." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>Enviar</CardTitle>
              <CardDescription>Describe el problema o la idea con el mayor detalle posible.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <FeedbackForm sections={sections} initialPage={from} />
          </CardContent>
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          {manage && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="size-4 text-brand-teal" /> Bandeja del administrador
                  </CardTitle>
                  <CardDescription>
                    {pending.length} abierto(s) de {all.length}. Solo tú ves esta bandeja; cada persona ve el estado y tu respuesta de lo que envió.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <FeedbackList items={all} timezone={tz} manage sectionLabel={sectionLabel} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Mis envíos</CardTitle>
                <CardDescription>Lo que has enviado, su estado y la respuesta del administrador.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <FeedbackList items={mine} timezone={tz} manage={false} sectionLabel={sectionLabel} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
