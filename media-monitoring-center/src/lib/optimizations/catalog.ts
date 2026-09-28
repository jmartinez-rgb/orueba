import type { PlatformId } from "@/lib/types";
import type { AnomalyType } from "@/lib/monitoring/types";

/**
 * Recomendaciones de optimización tomadas de la documentación oficial de cada plataforma
 * (centros de ayuda de Google Ads, Meta, TikTok, Microsoft Advertising, Spotify y X).
 * Son guías para que el equipo revise y decida: la app NO aplica ningún cambio.
 * Verificadas en septiembre de 2026; conviene revisar la fuente antes de actuar.
 */

export type RecTrigger = "DELIVERY" | "TRACKING" | "DATA" | "BUDGET" | "EFFICIENCY" | "PERFORMANCE";

export type RecArea = "Entrega" | "Medición" | "Aprendizaje" | "Presupuesto" | "Estructura" | "Frecuencia";

export interface Recommendation {
  id: string;
  platform: PlatformId;
  area: RecArea;
  title: string;
  /** Qué dice la documentación oficial (parafraseado). */
  why: string;
  /** Qué revisar en la plataforma (acción manual del equipo). */
  check: string;
  sources: Array<{ label: string; url: string }>;
  triggers: RecTrigger[];
}

export const TRIGGER_BY_ANOMALY: Record<AnomalyType, RecTrigger> = {
  DATA_ISSUE: "DATA",
  DELIVERY_CRITICAL: "DELIVERY",
  PLATFORM_INCIDENT: "DELIVERY",
  DELIVERY_ISSUE: "DELIVERY",
  UNDERSPEND: "DELIVERY",
  OVERSPEND: "BUDGET",
  TRACKING_ISSUE: "TRACKING",
  PERFORMANCE_ISSUE: "PERFORMANCE",
  EFFICIENCY_ISSUE: "EFFICIENCY",
  COST_INCREASE: "EFFICIENCY",
  PACING_DEVIATION: "BUDGET",
};

export const RECOMMENDATIONS: Recommendation[] = [
  // ── Google Ads ─────────────────────────────────────────────────────────────
  {
    id: "g-limited-budget",
    platform: "google",
    area: "Presupuesto",
    title: "Revisar el estado “Limitada por el presupuesto”",
    why: "Google indica que la campaña sigue activa pero muestra anuncios solo ocasionalmente cuando su presupuesto diario promedio es menor al recomendado para captar las impresiones y clics disponibles con su configuración actual.",
    check: "En la campaña, revisa el estado y la recomendación de presupuesto antes de concluir que la caída de gasto es un problema de subasta.",
    sources: [
      { label: "Google Ads · Corregir el estado “Limitada por el presupuesto”", url: "https://support.google.com/google-ads/answer/6385220" },
      { label: "Google Ads · Estados de campaña", url: "https://support.google.com/google-ads/answer/2549115" },
    ],
    triggers: ["DELIVERY", "BUDGET"],
  },
  {
    id: "g-bid-learning",
    platform: "google",
    area: "Aprendizaje",
    title: "Estrategia de oferta en “Aprendizaje”",
    why: "Tras crear o reactivar una estrategia de Smart Bidding, cambiar su configuración o su composición (campañas, grupos o palabras clave), su estado puede mostrarse como “Aprendizaje” mientras se calibra; puede tomar uno o dos ciclos de conversión.",
    check: "Antes de interpretar una caída de conversiones o un CPA al alza, revisa el estado de la estrategia de oferta y evita cambios encadenados durante ese periodo.",
    sources: [
      { label: "Google Ads · Estados de la estrategia de oferta", url: "https://support.google.com/google-ads/answer/6263057" },
      { label: "Google Ads · Duración del periodo de aprendizaje", url: "https://support.google.com/google-ads/answer/13020501" },
    ],
    triggers: ["PERFORMANCE", "EFFICIENCY"],
  },
  {
    id: "g-conversion-delay",
    platform: "google",
    area: "Medición",
    title: "Considerar el retraso de las conversiones",
    why: "Las conversiones se atribuyen al día del clic dentro de la ventana de conversión: el rendimiento más reciente puede verse peor y mejora conforme llegan conversiones, lo que puede tardar días o semanas.",
    check: "Al evaluar el día en curso, recuerda que MCC_Offline_Purchase y MCC_Offline_Lead_Contact llegan con retraso; compara contra la misma franja y no concluyas con pocas horas.",
    sources: [{ label: "Google Ads · Consejos para medir el rendimiento de Smart Bidding", url: "https://support.google.com/google-ads/answer/6268633" }],
    triggers: ["PERFORMANCE", "TRACKING"],
  },
  {
    id: "g-offline-diagnostics",
    platform: "google",
    area: "Medición",
    title: "Diagnóstico de las conversiones offline",
    why: "Google ofrece diagnósticos para importaciones offline y conversiones avanzadas para clientes potenciales (tasa de coincidencia y errores como “sin datos recientes”). Las conversiones con GCLID se pueden cargar hasta 90 días después del clic.",
    check: "Si las ventas caen con tráfico normal, revisa en Objetivos › Conversiones el diagnóstico de MCC_Offline_Purchase y MCC_Offline_Lead_Contact y la última carga.",
    sources: [
      { label: "Google Ads · Corregir discrepancias y errores en importaciones offline", url: "https://support.google.com/google-ads/answer/13321563" },
      { label: "Google Ads · Informe de diagnóstico de conversiones avanzadas para leads", url: "https://support.google.com/google-ads/answer/15249267" },
    ],
    triggers: ["TRACKING"],
  },
  {
    id: "g-data-manager",
    platform: "google",
    area: "Medición",
    title: "Cargas offline por Data Manager API (desde el 15 de junio de 2026)",
    why: "Desde el 15 de junio de 2026 las importaciones de conversiones offline y de conversiones avanzadas para leads migran a la Data Manager API y se bloquean en la Google Ads API para quien no tenía acceso previo.",
    check: "Confirma con el equipo técnico por qué vía se cargan MCC_Offline_Purchase / MCC_Offline_Lead_Contact; una carga interrumpida se ve como ventas en cero con gasto normal.",
    sources: [
      { label: "Google Ads · Pasar de importación offline a conversiones avanzadas para leads", url: "https://support.google.com/google-ads/answer/14274408" },
      { label: "Google Ads Developer Blog · Cambios en la importación de clics offline (mayo 2026)", url: "https://ads-developers.googleblog.com/2026/05/changes-to-offline-click-conversion.html" },
    ],
    triggers: ["TRACKING", "DATA"],
  },

  // ── Meta Ads ───────────────────────────────────────────────────────────────
  {
    id: "m-learning",
    platform: "meta",
    area: "Aprendizaje",
    title: "Fase de aprendizaje y ediciones significativas",
    why: "Meta recomienda esperar alrededor de 50 eventos de optimización desde la última edición significativa. Pausar el conjunto o cambiar el evento de optimización, la audiencia o el creativo reinicia el aprendizaje; si no se alcanza el volumen, el conjunto queda en “Aprendizaje limitado”.",
    check: "Antes de decidir por una caída, revisa si el conjunto está en aprendizaje o aprendizaje limitado y cuándo fue la última edición significativa.",
    sources: [
      { label: "Meta · Acerca de la fase de aprendizaje", url: "https://www.facebook.com/business/help/112167992830700" },
      { label: "Meta · Ediciones significativas y fase de aprendizaje", url: "https://www.facebook.com/business/help/316478108955072" },
      { label: "Meta · Acerca de Aprendizaje limitado", url: "https://www.facebook.com/business/help/269269737396981" },
    ],
    triggers: ["PERFORMANCE", "EFFICIENCY", "DELIVERY"],
  },
  {
    id: "m-payment",
    platform: "meta",
    area: "Entrega",
    title: "Pagos fallidos y límite de gasto de la cuenta",
    why: "Un pago fallido o alcanzar el límite de gasto de la cuenta detiene la publicación. El monto gastado contra el límite no se reinicia automáticamente.",
    check: "Si una cuenta o campaña dejó de gastar con datos al día, revisa facturación, método de pago y límite de gasto en el Business Manager.",
    sources: [
      { label: "Meta · Corregir un problema de pago fallido", url: "https://www.facebook.com/business/help/268196136699959" },
      { label: "Meta · Acerca de los límites de gasto de la cuenta", url: "https://www.facebook.com/business/help/141820733085330" },
    ],
    triggers: ["DELIVERY"],
  },
  {
    id: "m-rejected",
    platform: "meta",
    area: "Entrega",
    title: "Anuncios rechazados",
    why: "Un anuncio que no cumple las Normas publicitarias se rechaza; se puede editar, crear uno nuevo o solicitar otra revisión.",
    check: "Cuando un conjunto se queda sin entrega, revisa el estado de revisión de sus anuncios.",
    sources: [{ label: "Meta · Cómo solucionar un anuncio rechazado", url: "https://www.facebook.com/business/help/1210227555661027" }],
    triggers: ["DELIVERY"],
  },
  {
    id: "m-capi",
    platform: "meta",
    area: "Medición",
    title: "Conversions API + píxel con deduplicación y calidad de coincidencia",
    why: "Si se envían los mismos eventos por el píxel y por la Conversions API, Meta los deduplica con event_id; un event_id incorrecto puede deduplicar mal y afectar el reporte. Una mejor calidad de coincidencia (EMQ) ayuda a atribuir más conversiones.",
    check: "En el Administrador de eventos revisa deduplicación, frescura de datos y EMQ; en campañas CAPI WhatsApp la venta se mide con On-Facebook Purchase y no se mezcla con Compras Offline Web (Inbound).",
    sources: [
      { label: "Meta · Deduplicación entre píxel y Conversions API", url: "https://www.facebook.com/business/help/823677331451951" },
      { label: "Meta for Developers · Buenas prácticas de Conversions API", url: "https://developers.facebook.com/documentation/ads-commerce/conversions-api/best-practices" },
    ],
    triggers: ["TRACKING"],
  },

  // ── TikTok Ads ─────────────────────────────────────────────────────────────
  {
    id: "t-learning",
    platform: "tiktok",
    area: "Aprendizaje",
    title: "Fase de aprendizaje (~50 conversiones)",
    why: "TikTok indica que un grupo de anuncios debe lograr alrededor de 50 conversiones para salir del aprendizaje; si no obtiene al menos 20 en los primeros 10 días es muy probable que no lo logre. Se puede escalar cuando genera 50 conversiones en una semana y cumple los objetivos.",
    check: "Evalúa las caídas considerando el estado de aprendizaje del grupo de anuncios y evita cambios fuertes mientras aprende.",
    sources: [
      { label: "TikTok · Acerca de la fase de aprendizaje", url: "https://ads.tiktok.com/help/article/learning-phase" },
      { label: "TikTok · Preguntas frecuentes de la fase de aprendizaje", url: "https://ads.tiktok.com/help/article/learning-phase-faq" },
    ],
    triggers: ["PERFORMANCE", "EFFICIENCY"],
  },
  {
    id: "t-events",
    platform: "tiktok",
    area: "Medición",
    title: "Events API + píxel con deduplicación",
    why: "Si se usan el píxel y la Events API para los mismos eventos, TikTok requiere deduplicarlos con los parámetros event y event_id (ventana de 48 horas).",
    check: "En TikTok Events Manager revisa los diagnósticos y la deduplicación cuando caen los leads con tráfico normal.",
    sources: [
      { label: "TikTok · Deduplicación de eventos", url: "https://ads.tiktok.com/help/article/event-deduplication" },
      { label: "TikTok · Diagnóstico y monitoreo en Events Manager", url: "https://ads.tiktok.com/help/article/tiktok-events-manager-monitor-and-diagnose" },
    ],
    triggers: ["TRACKING"],
  },

  // ── Microsoft Advertising ──────────────────────────────────────────────────
  {
    id: "b-uet",
    platform: "microsoft",
    area: "Medición",
    title: "Etiqueta UET y objetivos de conversión",
    why: "Microsoft mide conversiones con la etiqueta UET y objetivos de conversión (se puede integrar con Google Tag Manager). Reporta la conversión en la fecha del clic, por lo que puede diferir de otras herramientas.",
    check: "Si caen conversiones con clics normales, valida la etiqueta con UET Tag Helper y revisa el estado de los objetivos de conversión.",
    sources: [
      { label: "Microsoft Advertising · Probar objetivos con UET Tag Helper", url: "https://help.ads.microsoft.com/#apex/ads/en/56775/2" },
      { label: "Microsoft Learn · Universal Event Tracking", url: "https://learn.microsoft.com/en-us/advertising/guides/universal-event-tracking" },
    ],
    triggers: ["TRACKING"],
  },
  {
    id: "b-import",
    platform: "microsoft",
    area: "Estructura",
    title: "Importación programada desde Google Ads",
    why: "La importación desde Google Ads puede programarse diaria, semanal o mensualmente para sincronizar cambios de campañas, presupuestos y estados.",
    check: "Si Microsoft replica campañas de Google, revisa el historial de importaciones cuando aparezcan diferencias de estructura, presupuesto o pausas inesperadas.",
    sources: [
      { label: "Microsoft Advertising · Importar campañas desde Google Ads", url: "https://help.ads.microsoft.com/#apex/ads/en/51050/0" },
      { label: "Microsoft Advertising · Editar importaciones programadas e historial", url: "https://help.ads.microsoft.com/apex/index/3/en/56817" },
    ],
    triggers: ["DELIVERY", "BUDGET"],
  },

  // ── Spotify Ads ────────────────────────────────────────────────────────────
  {
    id: "s-frequency",
    platform: "spotify",
    area: "Frecuencia",
    title: "Objetivo de entrega y tope de frecuencia",
    why: "Spotify optimiza según el objetivo de entrega del ad set y, por defecto, muestra los anuncios de un ad set a cada persona máximo 5 veces al día; se pueden definir topes diarios, semanales o mensuales.",
    check: "Si el CPM sube o las impresiones caen, revisa el objetivo de entrega y el tope de frecuencia del ad set.",
    sources: [{ label: "Spotify Ads · Optimizar la entrega del ad set", url: "https://adshelp.spotify.com/s/article/Optimizing-your-ad-set-delivery-US?language=en_US" }],
    triggers: ["DELIVERY", "EFFICIENCY"],
  },
  {
    id: "s-pixel",
    platform: "spotify",
    area: "Medición",
    title: "Spotify Pixel y Conversions API",
    why: "El Spotify Pixel mide acciones posteriores a escuchar el anuncio (ventana de atribución de 30 días); Spotify recomienda instalarlo una o dos semanas antes de la campaña. También existe una Conversions API.",
    check: "Si se quiere evaluar conversiones de Spotify, confirma que el píxel o la Conversions API envían eventos; sin ellos la plataforma se evalúa por alcance (impresiones y CPM).",
    sources: [
      { label: "Spotify Ads · Acerca del Spotify Pixel", url: "https://adshelp.spotify.com/s/article/About-the-Spotify-Pixel-US?language=en_US" },
      { label: "Spotify Ads · Conversions API", url: "https://adshelp.spotify.com/s/article/Spotify-Conversions-API-US?language=en_US" },
    ],
    triggers: ["TRACKING"],
  },

  // ── X Ads ──────────────────────────────────────────────────────────────────
  {
    id: "x-conversion",
    platform: "x",
    area: "Medición",
    title: "X Pixel o Conversion API para campañas web",
    why: "X indica que es crítico implementar al menos el X Pixel o la Conversion API (servidor a servidor, permite medir conversiones que terminan offline) para aprovechar las campañas web.",
    check: "Una campaña de conversiones que reporta NULL necesita el píxel o la Conversion API antes de evaluarse por conversiones.",
    sources: [
      { label: "X Business · Acerca del seguimiento de conversiones", url: "https://business.x.com/en/help/campaign-measurement-and-analytics/conversion-tracking-for-websites/about-conversion-tracking" },
      { label: "X Ads API · Conversiones web", url: "https://docs.x.com/x-ads-api/measurement/web-conversions" },
    ],
    triggers: ["TRACKING", "DATA"],
  },
];

/** Reglas de la cuenta izzi que aplican a cualquier recomendación. */
export const ACCOUNT_RULES = [
  "Métricas de decisión: ventas (cantidad) y CPA de venta. CTR y costo por conversación son secundarias y no definen conclusiones.",
  "Meta: campañas CAPI WhatsApp se miden con On-Facebook Purchase; el resto con Compras Offline Web (Inbound). La venta total suma ambos, el análisis se hace por separado.",
  "Google: solo MCC_Offline_Lead_Contact y MCC_Offline_Purchase como eventos offline válidos.",
  "CPA = SUMA(costo) ÷ SUMA(conversiones). Nunca se promedian CPAs.",
  "No se inventan umbrales ni valores de escala: medición constante y retroalimentación semanal.",
];
