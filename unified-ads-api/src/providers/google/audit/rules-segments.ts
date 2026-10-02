import { cpa, cpm, ctr, cvr, shouldServe, CHANNEL_LABEL } from "./aggregate.js";
import { CRITERIA, fmtNum, fmtPct, type Ctx, plural } from "./context.js";
import { poissonLowerTail, rateDropP } from "./stats.js";
import type { SegmentRow } from "./types.js";

export interface SegmentTotal {
  key: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export function bySegment(
  rows: Array<Pick<SegmentRow, "key" | "cost" | "impressions" | "clicks" | "conversions">>,
): SegmentTotal[] {
  const m = new Map<string, SegmentTotal>();
  for (const r of rows) {
    const t = m.get(r.key) ?? { key: r.key, cost: 0, impressions: 0, clicks: 0, conversions: 0 };
    t.cost += r.cost;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.conversions += r.conversions;
    m.set(r.key, t);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}

export function segmentRules(ctx: Ctx): void {
  geoRules(ctx);
  deviceRules(ctx);
  scheduleRules(ctx);
  urlRules(ctx);
  videoRules(ctx);
}

function geoRules(ctx: Ctx): void {
  const regions = bySegment(ctx.data.geo).filter((r) => r.key !== "Sin región identificada");
  const total = regions.reduce((s, r) => s + r.cost, 0);
  const conv = regions.reduce((s, r) => s + r.conversions, 0);
  const base = conv > 0 ? total / conv : null;
  if (!regions.length || base === null) return;
  const tested = regions.filter((r) => r.cost >= total * 0.03);
  const alpha = CRITERIA.significance / Math.max(1, tested.length);
  const worse = tested.filter((r) => {
    const expected = r.cost / base;
    const rCpa = cpa(r);
    return (
      expected >= 3 &&
      poissonLowerTail(r.conversions, expected) < alpha &&
      (rCpa === null || rCpa >= base * CRITERIA.cpaAlertRatio)
    );
  });
  const better = tested.filter((r) => {
    const rCpa = cpa(r);
    return rCpa !== null && r.conversions >= CRITERIA.minConversions && rCpa <= base / CRITERIA.cpaAlertRatio;
  });
  if (better.length)
    ctx.note(
      "geo",
      `Regiones con CPA notablemente mejor que la cuenta: ${better.map((r) => `${r.key} (CPA ${ctx.money(cpa(r))})`).join(", ")}.`,
    );
  if (worse.length)
    ctx.add({
      section: "geo",
      campaign: "Cuenta",
      title: `${plural(worse.length, "región", "regiones")} con CPA significativamente peor que la cuenta`,
      evidence: [
        `CPA de la cuenta por ubicación física (30 días): ${ctx.money(base)}. Prueba con corrección por ${tested.length} regiones comparadas.`,
        ...worse.map(
          (r) =>
            `${r.key}: ${ctx.money(r.cost)} (${fmtPct(r.cost / total, 0)}), ${fmtNum(r.conversions, 1)} conv., CPA ${ctx.money(cpa(r))}`,
        ),
      ],
      diagnosis:
        "La diferencia no se explica por azar con este volumen, pero puede deberse a cobertura del servicio o a la calidad de los leads, no a Google Ads.",
      action:
        "No excluir todavía: validar cobertura (FTTH y zonas con servicio) y la tasa de cierre en esas regiones; excluir solo donde no haya servicio.",
      steps: [
        "Cruzar con el mapa de cobertura y ventas por región.",
        "Si no hay cobertura, excluir la ubicación con control de cambios.",
        "Si hay cobertura, revisar la oferta local y la landing.",
      ],
      risk: "moderado",
      priority: "P3",
      confidence: "media",
      impact: `Hasta ${ctx.money(worse.reduce((s, r) => s + r.cost, 0))} al mes en regiones de menor eficiencia.`,
      metric: "CPA y ventas por región",
      observation: "14 a 28 días",
      rollback: "Quitar la exclusión de ubicación.",
      minutes: 60,
      when: "semana",
      stake: worse.reduce((s, r) => s + r.cost, 0),
      // Exceso frente al CPA de la cuenta (lo que costarían esas conversiones al CPA promedio).
      waste: worse.reduce((s, r) => s + Math.max(0, r.cost - r.conversions * base), 0),
      rule: null,
    });
}

const DEVICE_LABEL: Record<string, string> = {
  MOBILE: "Móvil",
  DESKTOP: "Escritorio",
  TABLET: "Tableta",
  CONNECTED_TV: "TV conectada",
  OTHER: "Otro",
};

function deviceRules(ctx: Ctx): void {
  const devices = bySegment(ctx.data.devices);
  const total = devices.reduce((s, d) => s + d.cost, 0);
  if (!devices.length || total <= 0) return;
  for (const d of devices) {
    if (d.cost < total * 0.1) continue;
    const rest = devices
      .filter((x) => x.key !== d.key)
      .reduce((s, x) => ({ clicks: s.clicks + x.clicks, conversions: s.conversions + x.conversions }), {
        clicks: 0,
        conversions: 0,
      });
    const p =
      rest.clicks >= CRITERIA.minClicks && rest.conversions >= CRITERIA.minConversions
        ? rateDropP(rest.conversions, rest.clicks, d.conversions, d.clicks)
        : null;
    const dCvr = cvr(d),
      rCvr = cvr(rest);
    if (
      p === null ||
      p >= CRITERIA.significance ||
      dCvr === null ||
      rCvr === null ||
      dCvr > rCvr / CRITERIA.cpaAlertRatio
    )
      continue;
    ctx.add({
      section: "devices",
      campaign: "Cuenta",
      title: `${DEVICE_LABEL[d.key] ?? d.key} convierte significativamente peor que el resto`,
      evidence: devices.map(
        (x) =>
          `${DEVICE_LABEL[x.key] ?? x.key}: ${ctx.money(x.cost)}, CTR ${fmtPct(ctr(x), 2)}, CVR ${fmtPct(cvr(x), 2)}, CPA ${ctx.money(cpa(x))}`,
      ),
      diagnosis:
        "La brecha de conversión suele venir de la experiencia en la página (velocidad, formulario, checkout), no de la puja.",
      action: `Revisar el flujo de conversión en ${DEVICE_LABEL[d.key] ?? d.key} con el equipo web antes de tocar la campaña.`,
      steps: [
        "Probar el formulario o el flujo de compra en ese dispositivo.",
        "Revisar velocidad (sección URLs).",
        "Escalar correcciones de UX.",
      ],
      risk: "bajo",
      priority: "P3",
      confidence: "media",
      impact: "Mejor tasa de conversión sin cambiar la inversión.",
      metric: `Tasa de conversión en ${DEVICE_LABEL[d.key] ?? d.key}`,
      observation: "14 días después de cada mejora",
      rollback: "No aplica.",
      minutes: 60,
      when: "semana",
      stake: d.cost,
      rule: null,
    });
  }
}

const DAY_LABEL: Record<string, string> = {
  MONDAY: "lunes",
  TUESDAY: "martes",
  WEDNESDAY: "miércoles",
  THURSDAY: "jueves",
  FRIDAY: "viernes",
  SATURDAY: "sábado",
  SUNDAY: "domingo",
};
const BLOCKS: Array<[number, number, string]> = [
  [0, 5, "00–05 h"],
  [6, 11, "06–11 h"],
  [12, 17, "12–17 h"],
  [18, 23, "18–23 h"],
];

function scheduleRules(ctx: Ctx): void {
  const rows = ctx.data.schedule;
  if (!rows.length) return;
  const total = rows.reduce((s, r) => s + r.cost, 0),
    conv = rows.reduce((s, r) => s + r.conversions, 0);
  const base = conv > 0 ? total / conv : null;
  if (base === null) return;
  const segments: SegmentTotal[] = [
    ...bySegment(
      rows.map((r) => ({
        key: DAY_LABEL[r.day] ?? r.day,
        cost: r.cost,
        impressions: 0,
        clicks: r.clicks,
        conversions: r.conversions,
      })),
    ),
    ...bySegment(
      rows.map((r) => ({
        key: BLOCKS.find(([a, b]) => r.hour >= a && r.hour <= b)?.[2] ?? "s/d",
        cost: r.cost,
        impressions: 0,
        clicks: r.clicks,
        conversions: r.conversions,
      })),
    ),
  ];
  const alpha = CRITERIA.significance / segments.length;
  const worse = segments.filter((s) => s.cost / base >= 3 && poissonLowerTail(s.conversions, s.cost / base) < alpha);
  ctx.note(
    "schedule",
    `CPA por bloque (30 días, cuenta): ${segments.map((s) => `${s.key} ${ctx.money(cpa(s))} (${fmtPct(s.cost / total, 0)} del gasto)`).join("; ")}.`,
  );
  if (worse.length)
    ctx.note(
      "schedule",
      `Bloques con CPA significativamente peor: ${worse.map((s) => s.key).join(", ")}. Con Smart Bidding la puja ya se ajusta por hora; se mantiene en observación.`,
    );
  if (ctx.campaigns.some((s) => s.info.bidding && /MAXIMIZE|TARGET_CPA|TARGET_ROAS/.test(s.info.bidding)))
    ctx.hold(
      "Campañas con Smart Bidding",
      "Programación de anuncios",
      "Smart Bidding ajusta por hora y día; restringir horarios con poca evidencia quita aprendizaje.",
    );
}

function urlRules(ctx: Ctx): void {
  const { data } = ctx;
  const usedBy = (url: string) => {
    const ads = data.ads.filter((a) => a.finalUrls.includes(url));
    const groups = data.assetGroups.filter((g) => g.finalUrls.includes(url));
    const landing = data.landing.find((l) => l.url === url);
    return {
      names: [...new Set([...ads.map((a) => ctx.name(a.campaignId)), ...groups.map((g) => ctx.name(g.campaignId))])],
      cost: landing?.cost ?? ads.reduce((s, a) => s + a.cost, 0),
    };
  };
  const broken = data.urlChecks.filter((u) => u.outcome === "error");
  if (broken.length)
    ctx.add({
      section: "urls",
      campaign: [...new Set(broken.flatMap((u) => usedBy(u.url).names))].slice(0, 3).join(", ") || "Varias",
      title: `${plural(broken.length, "URL de destino responde", "URLs de destino responden")} con error`,
      evidence: broken.map(
        (u) =>
          `${u.url} → HTTP ${u.status ?? "s/d"}${usedBy(u.url).names.length ? ` · usada en ${usedBy(u.url).names.slice(0, 3).join(", ")}` : ""}`,
      ),
      diagnosis:
        "Un clic que llega a una página con error se paga y no convierte; Google también puede rechazar el anuncio por destino no disponible.",
      action: "Corregir la página o cambiar la URL final de los anuncios afectados a una página vigente.",
      steps: [
        "Abrir cada URL en un navegador para confirmar.",
        "Corregir con el equipo web o actualizar la URL final.",
        "Revisar el estado de los anuncios a las 24 horas.",
      ],
      risk: "bajo",
      priority: "P0",
      confidence: broken.every((u) => u.status === 404 || u.status === 410) ? "alta" : "media",
      impact: "Dejar de pagar clics que no pueden convertir.",
      metric: "Estado HTTP y conversiones de la campaña",
      observation: "24 horas",
      rollback: "No aplica.",
      minutes: 20,
      when: "hoy",
      stake: broken.reduce((s, u) => s + usedBy(u.url).cost, 0),
      waste: broken.reduce((s, u) => s + usedBy(u.url).cost, 0),
      rule: "RULE-GADS-006",
    });
  const offsite = data.urlChecks.filter((u) => {
    if (u.outcome !== "redirect" || !u.location) return false;
    try {
      return new URL(u.location, u.url).hostname !== new URL(u.url).hostname;
    } catch {
      return false;
    }
  });
  if (offsite.length)
    ctx.add({
      section: "urls",
      campaign: "Varias",
      title: `${plural(offsite.length, "URL final redirige", "URLs finales redirigen")} a otro dominio`,
      evidence: offsite.slice(0, 10).map((u) => `${u.url} → ${u.location}`),
      diagnosis: "Las redirecciones entre dominios pueden perder el parámetro gclid y con él la atribución offline.",
      action: "Usar como URL final la dirección definitiva o confirmar que la redirección conserva los parámetros.",
      steps: [
        "Probar la URL con ?gclid=prueba y verificar que llegue al destino.",
        "Actualizar la URL final si se pierde.",
      ],
      risk: "bajo",
      priority: "P2",
      confidence: "media",
      impact: "Atribución completa de conversiones offline.",
      metric: "Conversiones importadas",
      observation: "7 días",
      rollback: "Restaurar la URL anterior.",
      minutes: 15,
      when: "48h",
      stake: offsite.reduce((s, u) => s + usedBy(u.url).cost, 0),
      rule: null,
    });
  const unverifiable = data.urlChecks.filter((u) => u.outcome === "unverifiable").length;
  if (unverifiable)
    ctx.note(
      "urls",
      `${unverifiable} URLs no se pudieron verificar (bloqueo de bots, tiempo agotado o red); revisarlas a mano si son relevantes.`,
    );
  if (!data.urlChecks.length) ctx.note("urls", "No se ejecutó la revisión HTTP de páginas de destino.");
  const top = [...data.landing].sort((a, b) => b.cost - a.cost).slice(0, 15);
  const slow = top
    .filter((l) => l.speedScore !== null)
    .sort((a, b) => (a.speedScore ?? 0) - (b.speedScore ?? 0))
    .slice(0, 5);
  if (slow.length)
    ctx.note(
      "urls",
      `Menor velocidad móvil entre las páginas con más gasto (escala 1–10): ${slow.map((l) => `${l.url} (${l.speedScore})`).join("; ")}.`,
    );
  const unfriendly = top.filter((l) => l.mobileFriendly !== null && l.mobileFriendly < 1);
  if (unfriendly.length)
    ctx.note(
      "urls",
      `Páginas con clics móviles a páginas no optimizadas para móvil: ${unfriendly.map((l) => `${l.url} (${fmtPct(l.mobileFriendly, 0)})`).join("; ")}.`,
    );
  const home = data.landing.filter((l) => {
    try {
      return new URL(l.url).pathname.replace(/\/+$/, "") === "";
    } catch {
      return false;
    }
  });
  const totalLanding = data.landing.reduce((s, l) => s + l.cost, 0);
  const homeCost = home.reduce((s, l) => s + l.cost, 0);
  if (totalLanding > 0 && homeCost / totalLanding >= 0.3)
    ctx.note(
      "urls",
      `${fmtPct(homeCost / totalLanding, 0)} del gasto llega a la página de inicio: revisar si hay páginas más específicas por oferta.`,
    );
}

const APP_NOISE = /(game|games|juego|juegos|puzzle|slots|casino|kids|ninos|infantil|cartoon|caricatura)/i;

function videoRules(ctx: Ctx): void {
  const { data } = ctx;
  const campaigns = ctx.campaigns.filter(
    (s) => ["DISPLAY", "VIDEO", "DEMAND_GEN"].includes(s.info.channel) && s.w.L30.cost > 0,
  );
  for (const s of campaigns) {
    const f = data.frequency.find((x) => x.campaignId === s.info.id);
    ctx.note(
      "video",
      `${s.info.name} (${CHANNEL_LABEL[s.info.channel] ?? s.info.channel}${shouldServe(s.info, data.end) ? "" : ", no activa"}): ${ctx.money(s.w.L30.cost)}, ${fmtNum(s.w.L30.impressions)} impr., CTR ${fmtPct(ctr(s.w.L30), 2)}, CPM ${ctx.money(cpm(s.w.L30))}, ${fmtNum(s.w.L30.conversions, 1)} conv., CPA ${ctx.money(cpa(s.w.L30))}${f?.frequency ? `, frecuencia ${fmtNum(f.frequency, 1)}` : ""}${f?.uniqueUsers ? `, ${fmtNum(f.uniqueUsers)} usuarios únicos` : ""}.`,
    );
  }
  const noisy = data.placements.filter(
    (p) =>
      p.conversions === 0 &&
      p.cost > 0 &&
      (p.type === "MOBILE_APPLICATION" || p.placement.startsWith("mobileapp::")) &&
      APP_NOISE.test(`${p.name} ${p.placement}`),
  );
  if (noisy.length)
    ctx.add({
      section: "video",
      campaign: [...new Set(noisy.map((p) => ctx.name(p.campaignId)))].slice(0, 3).join(", "),
      title: `${plural(noisy.length, "ubicación", "ubicaciones")} en apps de juegos o infantiles con gasto y sin conversiones`,
      evidence: [
        `Gasto 30 días: ${ctx.money(noisy.reduce((s, p) => s + p.cost, 0))}.`,
        ...noisy
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 10)
          .map((p) => `${p.name || p.placement} · ${ctx.money(p.cost)} · ${fmtNum(p.clicks)} clics`),
      ],
      diagnosis: "Las apps de juegos e infantiles suelen generar clics accidentales sin intención de contratar.",
      action: "Excluir esas ubicaciones a nivel campaña o en una lista de exclusión compartida.",
      steps: [
        "Revisar la lista en el Excel.",
        "Agregar exclusiones de ubicación.",
        "Vigilar conversiones totales 14 días.",
      ],
      risk: "bajo",
      priority: "P2",
      confidence: "media",
      impact: "Menos clics accidentales.",
      metric: "Gasto en apps excluidas y conversiones totales",
      observation: "14 días",
      rollback: "Quitar las exclusiones.",
      minutes: 15,
      when: "48h",
      stake: noisy.reduce((s, p) => s + p.cost, 0),
      waste: noisy.reduce((s, p) => s + p.cost, 0),
      rule: null,
    });
}
