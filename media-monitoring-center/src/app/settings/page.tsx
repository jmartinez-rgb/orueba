import type { Metadata } from "next";
import { getAppContext } from "@/lib/services/context";
import { maskAddress } from "@/lib/format";
import { can, ROLE_LABEL } from "@/lib/auth/roles";
import { getEnv } from "@/lib/config/env";
import { PageHeader } from "@/components/monitoring/page-header";
import { SettingsForm } from "@/components/monitoring/settings-form";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getAppContext();
  const env = getEnv();
  const canEdit = can(ctx.session.role, "settings:write");
  const catalog = await ctx.source.getCatalog();
  const settings = canEdit ? ctx.settings : { ...ctx.settings, recipients: ctx.settings.recipients.map((r) => ({ ...r, address: maskAddress(r.address) })) };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        subtitle={`${ctx.mode === "mock" ? "MOCK MODE: los cambios se guardan en este navegador (cookie)." : "Los cambios se guardan en BigQuery (monitoring_settings) para todo el equipo."} Rol actual: ${ROLE_LABEL[ctx.session.role]}${env.auth.mode === "dev" ? " (modo desarrollo: cámbialo desde el menú de usuario)" : ""}.`}
      />
      <SettingsForm initial={settings} canEdit={canEdit} mode={ctx.mode} campaigns={catalog.campaigns.map((c) => ({ id: c.id, name: c.name, platform: c.platform, objective: c.objective }))} />
    </div>
  );
}
