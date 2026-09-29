import "server-only";
import type { PlatformId } from "@/lib/types";
import { getEnv } from "@/lib/config/env";
import { PLATFORMS } from "@/lib/platforms/registry";
import { lastIntegrationEvent } from "@/lib/logging/logger";
import { WORKFLOWS } from "@/lib/n8n/workflows";
import type { Snapshot } from "./snapshot";

export type IntegrationStatus = "CONNECTED" | "MOCK" | "NOT_CONFIGURED" | "DEGRADED" | "DELAYED" | "ERROR" | "DISABLED";

export interface IntegrationItem {
  id: string;
  name: string;
  group: "platform" | "core";
  platform?: PlatformId;
  status: IntegrationStatus;
  lastLabel: string;
  lastAt: string | null;
  detail: string;
  facts: Array<{ label: string; value: string }>;
  testable?: "bigquery" | "sheets" | "n8n";
}

export function getIntegrations(snap: Snapshot): IntegrationItem[] {
  const env = getEnv();
  const mock = snap.meta.mode === "mock";
  const items: IntegrationItem[] = [];
  for (const p of snap.run.platforms) {
    const h = snap.run.dataHealth[p];
    const wf = WORKFLOWS.find((w) => w.platform === p);
    const status: IntegrationStatus = h.state === "OK" ? "CONNECTED" : h.state === "PARTIAL" ? "DEGRADED" : h.state === "DELAYED" ? "DELAYED" : "ERROR";
    items.push({
      id: p,
      name: PLATFORMS[p].name,
      group: "platform",
      platform: p,
      status,
      lastLabel: "Last data received",
      lastAt: h.lastDataAt,
      detail: `${snap.meta.mode === "sheets" ? "Dataslayer → Google Sheets" : `${wf?.id ?? "n8n"} → BigQuery`}. ${h.checks.filter((c) => c.status !== "OK").map((c) => c.detail).join(" · ") || "Sin incidencias de datos."}`,
      facts: [
        { label: "Última sync", value: h.lastSyncStatus },
        { label: "Salud del dato", value: `${h.score}/100` },
        { label: "Origen", value: mock ? "Simulado" : snap.meta.mode === "sheets" ? "Google Sheets" : "BigQuery" },
      ],
    });
  }

  const sheetsEvent = lastIntegrationEvent("sheets");
  const sm = snap.meta.sheets;
  const sheetsActive = snap.meta.mode === "sheets";
  items.push({
    id: "sheets",
    name: "Google Sheets (Dataslayer)",
    group: "core",
    status: sheetsActive ? (sm?.errors.length ? "DEGRADED" : sheetsEvent && !sheetsEvent.ok ? "ERROR" : "CONNECTED") : env.requestedDataSource === "sheets" ? "ERROR" : "NOT_CONFIGURED",
    lastLabel: "Last read",
    lastAt: sheetsActive ? (sheetsEvent?.at ?? sm?.readAt ?? null) : null,
    detail: sheetsActive
      ? sm?.errors.length
        ? sm.errors.join(" · ")
        : `${sm?.title ? `"${sm.title}"` : "Hoja"}: ${sm?.tabs.filter((t) => t.found).length ?? 0} pestañas leídas. La app solo lee (cuenta de servicio con permiso de Lector).`
      : env.requestedDataSource === "sheets"
        ? `DATA_SOURCE=sheets pero falta configuración: ${[!env.sheets.spreadsheetId && "SHEETS_SPREADSHEET_ID", !env.sheets.credentials && "GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY", ...(snap.meta.sheets?.errors ?? [])].filter(Boolean).join(", ")}. Mientras tanto se usan datos simulados.`
        : "Para leer la hoja de Dataslayer: DATA_SOURCE=sheets, SHEETS_SPREADSHEET_ID y la cuenta de servicio (docs/INSTALACION.md).",
    facts: [
      { label: "Hoja", value: sm?.title ?? (env.sheets.spreadsheetId ? "Configurada" : "—") },
      { label: "Credenciales", value: env.sheets.credentials ? "Cuenta de servicio configurada" : env.sheets.fixtureFile ? "Archivo de prueba" : "—" },
      ...(sm?.tabs ?? []).map((t) => ({
        label: `${t.platform} · ${t.sheet}`,
        value: !t.found ? "No encontrada" : `${t.rows ?? 0} filas${t.updatedAt ? ` · ${new Date(t.updatedAt).toLocaleString("es-MX", { timeZone: snap.settings.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}`,
      })),
    ],
    testable: "sheets",
  });

  const bqEvent = lastIntegrationEvent("bigquery");
  items.push({
    id: "bigquery",
    name: "Google BigQuery",
    group: "core",
    status: sheetsActive && !env.bigquery.configured ? "NOT_CONFIGURED" : mock ? (env.bigquery.configured && snap.meta.mappingErrors.length ? "ERROR" : "MOCK") : bqEvent && !bqEvent.ok ? "ERROR" : "CONNECTED",
    lastLabel: "Last query",
    lastAt: mock ? null : (bqEvent?.at ?? null),
    detail: sheetsActive
      ? "No se usa: los datos se leen directamente de la hoja de Google Sheets (Dataslayer)."
      : mock
      ? snap.meta.mappingErrors.length
        ? `Configurado pero el mapeo es inválido; se usa MOCK: ${snap.meta.mappingErrors.join(" · ")}`
        : "MOCK MODE activo (USE_MOCK_DATA=true). La capa de datos está lista: define proyecto, dataset y BIGQUERY_MAPPING."
      : bqEvent
        ? `${bqEvent.action}: ${bqEvent.detail ?? ""}`
        : "Sin consultas en esta instancia todavía.",
    facts: [
      { label: "Proyecto", value: env.bigquery.projectId ?? "—" },
      { label: "Dataset", value: env.bigquery.dataset ?? "—" },
      { label: "Ubicación", value: env.bigquery.location },
      { label: "Credenciales", value: env.bigquery.serviceAccountJson || (env.bigquery.clientEmail && env.bigquery.privateKey) ? "Service account configurada" : "ADC / sin definir" },
      { label: "Límite por consulta", value: `${(env.bigquery.maxBytesBilled / 1024 ** 3).toFixed(1)} GB` },
    ],
    testable: "bigquery",
  });

  const n8nEvent = lastIntegrationEvent("n8n");
  const lastRun = snap.runs[snap.runs.length - 1];
  items.push({
    id: "n8n",
    name: "n8n",
    group: "core",
    status: env.n8n.configured ? (n8nEvent && !n8nEvent.ok ? "ERROR" : "CONNECTED") : mock ? "MOCK" : "NOT_CONFIGURED",
    lastLabel: "Last execution",
    lastAt: n8nEvent?.at ?? lastRun?.at ?? null,
    detail: env.n8n.configured
      ? (n8nEvent ? `${n8nEvent.action}: ${n8nEvent.detail ?? ""}` : "Webhooks configurados. Sin ejecuciones en esta instancia todavía.")
      : mock
        ? "Webhooks simulados. Las corridas programadas se reproducen localmente (07:00–23:00 cada 2 h)."
        : "Configura N8N_BASE_URL y los webhooks.",
    facts: [
      { label: "Monitoring webhook", value: env.n8n.monitoringWebhook ? "Configurado" : "—" },
      { label: "Alert webhook", value: env.n8n.alertWebhook ? "Configurado" : "—" },
      { label: "Manual sync webhook", value: env.n8n.manualSyncWebhook ? "Configurado" : "—" },
      { label: "Firma HMAC", value: env.n8n.webhookSecret ? "Activa" : "Sin secreto" },
      { label: "API key (n8n → app)", value: env.monitoringApiKey ? "Configurada" : "—" },
    ],
    testable: "n8n",
  });

  const wa = [...snap.state.notifications].filter((n) => n.channel === "whatsapp").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  items.push({
    id: "whatsapp",
    name: "WhatsApp Business Cloud API",
    group: "core",
    status: env.whatsapp.enabled ? (wa?.status === "FAILED" ? "ERROR" : "CONNECTED") : mock ? "MOCK" : "DISABLED",
    lastLabel: "Last notification",
    lastAt: wa?.createdAt ?? null,
    detail: "Sale siempre por n8n (WF08). El token de WhatsApp vive en las credenciales de n8n, nunca en la app ni en el navegador.",
    facts: [
      { label: "Envío", value: env.whatsapp.enabled ? "Activo" : mock ? "Simulado" : "Desactivado" },
      { label: "Template alerta", value: env.whatsapp.templateAlert },
      { label: "Template recuperación", value: env.whatsapp.templateRecovery },
      { label: "Idioma", value: env.whatsapp.templateLanguage },
      { label: "Último estado", value: wa ? `${wa.id} · ${wa.status}` : "—" },
    ],
  });
  return items;
}
