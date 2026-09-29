import type { Metadata } from "next";
import Link from "next/link";
import { Eye } from "lucide-react";
import { safeSnapshot } from "@/lib/services/safe";
import { baseSettings } from "@/lib/services/context";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/auth/roles";
import { NAV_GROUPS } from "@/components/layout/nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/monitoring/page-header";
import { SeverityBadge } from "@/components/monitoring/status";
import { ClassifierEditor } from "@/components/settings/classifier-editor";
import { FeatureBadge } from "@/components/rareui/feature-badge";

export const metadata: Metadata = { title: "Guía" };
export const dynamic = "force-dynamic";

/** Qué hay en cada sección y para qué se usa. */
const SECTION_HELP: Record<string, { what: string; when: string }> = {
  "/": { what: "Estado general, semáforo por plataforma con su métrica monitoreada, confianza de datos, carga de datos, alertas e incidentes abiertos y curva de gasto.", when: "Lo primero al entrar: responde en segundos si todo está funcionando." },
  "/live": { what: "Vista hora por hora del día en curso vs el mismo día de semanas anteriores.", when: "Para ver cuándo empezó una caída o un pico." },
  "/platforms": { what: "Resumen por plataforma y detalle de cada una: cuentas, estrategias, curvas, comparación histórica, campañas y salud de datos.", when: "Para bajar de la plataforma a la cuenta y a la campaña." },
  "/campaigns": { what: "Todas las campañas con su KPI según objetivo, desviación y alertas.", when: "Para encontrar qué campaña explica una variación." },
  "/monitoreos": { what: "Arma el mensaje de monitoreo para WhatsApp con el formato del equipo (semáforos, conversiones por cuenta, campañas sin gasto, más gasto que ayer, caídas vs la semana pasada).", when: "En cada corte: se revisa, se copia y se envía manualmente. Queda un historial." },
  "/alerts": { what: "Una alerta por anomalía detectada; las campañas con la misma causa se agrupan.", when: "Para cambiar el estado de una alerta o marcar falsos positivos." },
  "/incidents": { what: "Anomalías persistentes o graves con su línea de tiempo, notas y notificaciones.", when: "Para dar seguimiento y documentar lo que se hizo." },
  "/tickets": { what: "Reportes de problemas graves: a quién se reportó, por qué canal, número de caso y evolución. Histórico consultable y exportable.", when: "Cuando un problema requiere reportarse a la plataforma, al líder o al cliente." },
  "/budget": { what: "Presupuesto mensual vs gasto, pacing y forecast por plataforma, cuenta y campaña; nivel de presupuesto por cuenta.", when: "Para anticipar sobre o subejercicio y confirmar si una cuenta se mide a nivel cuenta o campaña." },
  "/compare": { what: "Compara cualquier fecha contra semanas anteriores por plataforma, cuenta, estrategia, objetivo o campaña, con gráfica y tabla.", when: "Para análisis puntuales y para explicar una variación con datos." },
  "/historical": { what: "Tendencia diaria, perfil por día de la semana y mapa de calor por hora.", when: "Para entender patrones normales." },
  "/metricas": { what: "Métrica monitoreada y métricas fijas por plataforma, objetivos fijos opcionales y catálogo de definiciones.", when: "Para decidir qué se vigila en cada plataforma." },
  "/optimizaciones": { what: "Recomendaciones de la documentación oficial de cada plataforma, cruzadas con las anomalías de hoy, con enlace a la fuente.", when: "Para saber qué revisar en la plataforma ante un problema. Nada se aplica automáticamente." },
  "/integrations": { what: "Flujo de datos (API directa o Sheets/Dataslayer/Apps Script), hoja de control de ejecución, monedas y estado de BigQuery, n8n y WhatsApp.", when: "Cuando la confianza baja o la carga de datos está pendiente." },
  "/automation": { what: "Workflows de n8n (ingestas, monitoreo cada 2 horas, alertas, escalamientos, recuperaciones).", when: "Para entender qué corre automáticamente." },
  "/usuarios": { what: "Personas, accesos y bitácora de actividad (solo administradores).", when: "Para saber quién entró y qué hizo." },
  "/settings": { what: "Umbrales, horarios, histórico, destinatarios, tipo de cambio mensual, moneda por cuenta y clasificadores de estrategia.", when: "Para ajustar cómo evalúa el monitoreo (no cambia nada en las plataformas)." },
  "/guia": { what: "Esta guía.", when: "Siempre que haya dudas." },
  "/sugerencias": { what: "Envía un bug o una sugerencia y consulta su estado. Solo el administrador recibe la bandeja completa y responde.", when: "Cuando algo no funciona o se te ocurre una mejora." },
};

const GLOSSARY: Array<[string, string]> = [
  ["Franja horaria", "Ventana 00:00 → hora de corte. Hoy siempre se compara contra la misma franja del mismo día de la semana en semanas anteriores."],
  ["Esperado", "Promedio (o mediana) de las semanas de referencia en la misma franja."],
  ["Desviación", "(Hoy − esperado) ÷ esperado."],
  ["NULL", "No hay dato (no se reporta, no aplica o la fuente está atrasada). Nunca se interpreta como cero."],
  ["DATA DELAYED", "La fuente no ha enviado datos recientes: no se evalúa rendimiento para no confundir un atraso con una caída."],
  ["Parcial", "Una o más cuentas de la plataforma están atrasadas y se excluyen de la comparación."],
  ["Confianza de datos", "0–100 %: baja con atrasos, errores, cuentas excluidas, horas faltantes, duplicados, pasos de carga pendientes, tipo de cambio faltante o histórico incompleto."],
  ["Alerta", "Una anomalía detectada en una evaluación."],
  ["Incidente", "Anomalía grave o persistente; se actualiza en vez de duplicarse y notifica al abrir, escalar, empeorar, durar demasiado y recuperarse."],
  ["Acuse", "Confirmación obligatoria de que alguien revisó una alerta crítica y la va a reportar."],
  ["Ticket", "Registro del reporte de un problema grave (a quién, canal, número de caso, seguimiento)."],
  ["Pacing", "Gasto real vs el esperado a esa hora según la curva horaria histórica."],
  ["Forecast", "Proyección de cierre del día o del mes con la curva horaria y el ritmo reciente."],
  ["CPA / CPL / CPR", "Costo por conversión / lead / resultado: SUMA(costo) ÷ SUMA(resultado). Nunca se promedian."],
  ["CTR / CPC / CPM", "Clics ÷ impresiones · costo ÷ clics · costo ÷ impresiones × 1,000."],
  ["Estrategia", "Clasificación de la campaña según su nombre (réplica de las fórmulas de la hoja)."],
];

const FLOW = [
  "Abre el Overview: el estado general y el color de cada plataforma responden si todo está bien.",
  "Si aparece la alerta crítica a pantalla completa, revisa el problema, escribe qué revisaste y a quién lo vas a reportar. Puede crear un ticket automáticamente.",
  "Revisa la carga de datos y la confianza: si dice “Debe ejecutarse”, corre el paso pendiente (Dataslayer / Apps Script) antes de sacar conclusiones.",
  "Entra a la plataforma en rojo o naranja y baja a cuentas, estrategias y campañas.",
  "Consulta Optimizaciones para saber qué revisar en la plataforma según la documentación oficial.",
  "Genera el mensaje en Monitoreos, corrige semáforos si hace falta, marca las revisiones de Zapier, cópialo y envíalo por WhatsApp. Guárdalo en el historial.",
  "Si el problema es grave, documenta el reporte en Tickets y actualízalo hasta cerrarlo.",
];

export default async function GuidePage() {
  const res = await safeSnapshot();
  const settings = res.ok ? res.snap.settings : baseSettings();
  const t = settings.thresholds;
  const toc = [
    ["inicio", "Qué es"],
    ["semaforo", "Cómo leer el semáforo"],
    ["flujo-diario", "Flujo diario sugerido"],
    ["secciones", "Qué hay en cada sección"],
    ["datos", "Datos, monedas y presupuestos"],
    ["confianza", "Confianza de datos"],
    ["clasificadores", "Clasificadores de estrategia"],
    ["accesos", "Roles y accesos"],
    ["glosario", "Glosario"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Guía" subtitle="Qué hay en cada parte del Monitoring Center, cómo leerlo y cómo funciona por dentro." />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Contenido de la guía" className="h-fit rounded-lg border bg-card p-3 text-sm lg:sticky lg:top-20">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Contenido</p>
          <ol className="space-y-1">
            {toc.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted-foreground hover:text-foreground">
                  {i + 1}. {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <Card id="inicio" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Qué es</CardTitle>
                <CardDescription>Centro de monitoreo de Paid Media de izzi y Sky: Google, Meta, TikTok, Microsoft y Spotify.</CardDescription>
              </div>
              <FeatureBadge badge="Solo lectura">No modifica nada</FeatureBadge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Responde en segundos <strong>“¿Está todo funcionando correctamente?”</strong>: detecta caídas o picos de gasto, problemas de conversión o de tracking, datos atrasados y desvíos
                de presupuesto, y ayuda a reportarlos.
              </p>
              <p>
                <strong>izzi y Sky son dos monitoreos separados.</strong> El botón <strong>izzi | Sky</strong> de la barra superior cambia entre ellos en un clic; el color de la app cambia (verde
                izzi, azul Sky) y cada botón muestra el estado de su marca y cuántos críticos tiene abiertos. Las cuentas se asignan por su nombre (&quot;Sky - ABCW&quot; es Sky, &quot;izzi -
                Ofertas&quot; es izzi); la cuenta mixta &quot;izzi - Sky Social&quot; se separa por campaña. Cada marca tiene sus alertas, incidentes (Sky: SKY-INC-…), tickets y mensajes.
              </p>
              <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs">
                <Eye className="mt-0.5 size-4 shrink-0 text-brand-teal" /> Es una plataforma solo de monitoreo: no cambia campañas, presupuestos ni configuraciones en ninguna plataforma. Todo ajuste se hace
                manualmente en cada plataforma por el equipo responsable.
              </p>
            </CardContent>
          </Card>

          <Card id="semaforo" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Cómo leer el semáforo</CardTitle>
                <CardDescription>Regla principal: mismo día de la semana y misma franja horaria vs {settings.history.weeks} semanas anteriores ({settings.history.baseline === "mean" ? "promedio" : "mediana"}).</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <SeverityBadge severity="NORMAL" /> <span className="text-xs">menos de {Math.round(t.attention * 100)}%</span>
                </div>
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <SeverityBadge severity="ATTENTION" /> <span className="text-xs">
                    {Math.round(t.attention * 100)}–{Math.round(t.alert * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <SeverityBadge severity="ALERT" /> <span className="text-xs">
                    {Math.round(t.alert * 100)}–{Math.round(t.critical * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <SeverityBadge severity="CRITICAL" /> <span className="text-xs">más de {Math.round(t.critical * 100)}%</span>
                </div>
              </div>
              <p>El porcentaje no decide solo. La severidad se ajusta por:</p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Volumen: entidades con poco gasto o pocos resultados no generan alertas (evita ruido estadístico).</li>
                <li>Variabilidad histórica: si la desviación está dentro de lo normal para esa entidad, baja un nivel.</li>
                <li>Hora del día: temprano, o cuando todavía no ocurre ni el 20% del volumen del día, baja un nivel.</li>
                <li>Frescura: con datos atrasados no se evalúa rendimiento (DATA DELAYED, en gris).</li>
                <li>Peso: una campaña pequeña no pinta de rojo toda la plataforma; varias campañas cayendo a la vez sí (incidente de plataforma).</li>
                <li>Objetivo: cada campaña se evalúa con el KPI de su objetivo; cada plataforma con su métrica monitoreada (se elige en el Overview o en Métricas).</li>
              </ul>
            </CardContent>
          </Card>

          <Card id="flujo-diario" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Flujo diario sugerido</CardTitle>
                <CardDescription>El monitoreo corre cada {settings.schedule.intervalHours} horas de {String(settings.schedule.startHour).padStart(2, "0")}:00 a {String(settings.schedule.endHour).padStart(2, "0")}:00.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {FLOW.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card id="secciones" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Qué hay en cada sección</CardTitle>
                <CardDescription>El menú está agrupado en Monitoreo, Alertas, Análisis, Operación y Ayuda.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {NAV_GROUPS.map((g) => (
                <div key={g.label}>
                  <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {g.items.map((item) => {
                      const Icon = item.icon;
                      const help = SECTION_HELP[item.href];
                      return (
                        <Link key={item.href} href={item.href} className="flex gap-3 rounded-md border px-3 py-2.5 transition-colors hover:border-foreground/25">
                          <Icon className="mt-0.5 size-4 shrink-0 text-brand-teal" />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{item.label}</span>
                            <span className="block text-xs text-muted-foreground">{help?.what}</span>
                            {help?.when && <span className="mt-0.5 block text-[11px]">Úsala: {help.when}</span>}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card id="datos" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Datos, monedas y presupuestos</CardTitle>
                <CardDescription>La app solo lee los datos (hoja de Dataslayer o BigQuery) y nunca se conecta a ellos desde el navegador.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  <strong>Hoja de Dataslayer:</strong> Dataslayer actualiza la hoja “Monitoreo | Big Query” cada 2 horas (tarda 5–10 minutos) y la app la lee directamente, solo lectura. La
                  pestaña DataslayerQueries dice cuándo se actualizó cada plataforma; su estado aparece en el Overview (“Carga de datos”) y en Integrations.
                </li>
                <li>
                  <strong>Franja horaria:</strong> la fila de hoy es el acumulado a la hora de la actualización. Con las pestañas por hora de Dataslayer la comparación de la misma franja es exacta; sin
                  ellas se estima con una curva típica, la app lo avisa y las alertas que dependen del gasto esperado a esa hora bajan un nivel (máximo Alerta).
                </li>
                <li>
                  <strong>Conversiones con retraso:</strong> las de Google y las ventas offline de Meta se suben horas o días después. En el día no se juzgan (se muestran en gris con la nota “llegan con
                  retraso”); el gasto sí se evalúa.
                </li>
                <li>
                  <strong>Cambio sostenido:</strong> si una cuenta o campaña lleva 3 días en otro nivel de gasto (por ejemplo, se le movió presupuesto), la severidad se mide contra ese nivel nuevo. Si hoy
                  sigue igual, queda en Atención con la nota “parece un cambio de presupuesto”.
                </li>
                <li>
                  <strong>Varias cuentas por plataforma:</strong> cada cuenta se evalúa por separado y también dentro de su plataforma; una cuenta atrasada se excluye sin afectar a las demás.
                </li>
                <li>
                  <strong>Monedas:</strong> hay cuentas en MXN y en USD. Todo se reporta en MXN: el gasto en USD se multiplica por la tasa del mes de cada fecha (se captura en Settings → Moneda). Sin tasa
                  del mes se usa la anterior y baja la confianza.
                </li>
                <li>
                  <strong>Presupuestos:</strong> algunas cuentas tienen un presupuesto único y otras uno por campaña. En Budget Control se confirma cuál aplica para medir el pacing sin duplicar.
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card id="confianza" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Confianza de datos</CardTitle>
                <CardDescription>Qué tan confiable es lo que muestra el monitoreo en este momento (0–100 %).</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Sin datos del día: 0 %. Error de sincronización: máximo 20 %. Datos atrasados: máximo 40 %.</li>
                <li>Cuentas atrasadas excluidas: descuenta según su peso en el gasto (mínimo 10 puntos).</li>
                <li>Horas faltantes, filas duplicadas, gasto NULL o carga incompleta de la última hora.</li>
                <li>Hoja de control: paso con error (−30), pendiente (−20), vencido (−15) o parcial (−10).</li>
                <li>Tipo de cambio: mes sin tasa (−25) o usando la del mes anterior (−5 por mes).</li>
                <li>Histórico incompleto: −5 por cada semana de referencia sin dato.</li>
              </ul>
              <p className="mt-2 text-xs">Pasa el cursor sobre el indicador de confianza para ver el motivo de cada punto descontado. Alta ≥ 85 %, media ≥ 60 %, baja &lt; 60 %.</p>
            </CardContent>
          </Card>

          <Card id="clasificadores" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Clasificadores de estrategia</CardTitle>
                <CardDescription>Réplica de las fórmulas de la hoja. Prueba un nombre de campaña para ver qué estrategia le toca y por qué regla. Se editan en Settings.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Se evalúan en orden: gana la primera regla que coincide. El orden importa (p. ej. en Meta “Sitio Web” va antes que “Venta”).</li>
                <li>No distingue mayúsculas pero sí acentos: en Google “gené” encuentra “Genéricas” pero no “Genericas”; esa campaña cae en el respaldo (su tipo de campaña).</li>
                <li>Reglas repetidas nunca se aplican (Meta: la segunda “WhatsApp”; Google: la segunda “izzi móvil DEMAND GEN”). Se marcan con un aviso.</li>
                <li>En Google la regla asigna “DEMAND GEN” (con espacio) y el respaldo usa el tipo “DEMAND_GEN”: aparecen como dos estrategias distintas; conviene unificar el texto.</li>
              </ul>
              <ClassifierEditor initial={settings.classifiers} canEdit={false} />
            </CardContent>
          </Card>

          <Card id="accesos" className="scroll-mt-20">
            <CardHeader>
              <div>
                <CardTitle>Roles y accesos</CardTitle>
                <CardDescription>Cuentas nominales con contraseña propia y una contraseña universal con la que cada persona entra con su nombre. Cada acceso queda registrado.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {ROLES.map((r) => (
                <p key={r}>
                  <strong>{ROLE_LABEL[r]}:</strong> <span className="text-muted-foreground">{ROLE_DESCRIPTION[r]}</span>
                </p>
              ))}
              <p className="text-xs text-muted-foreground">Cada persona tiene un avatar (blobatar) generado a partir de su nombre. Tras 5 intentos fallidos el acceso se bloquea 10 minutos.</p>
            </CardContent>
          </Card>

          <Card id="glosario" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Glosario</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                {GLOSSARY.map(([term, def]) => (
                  <div key={term}>
                    <dt className="font-semibold">{term}</dt>
                    <dd className="text-xs text-muted-foreground">{def}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
