"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bug, Download, Lightbulb, Send } from "lucide-react";
import { sileo } from "sileo";
import {
  FEEDBACK_IMPACT_LABEL,
  FEEDBACK_IMPACTS,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUSES,
  OPEN_FEEDBACK_STATUSES,
  type Feedback,
  type FeedbackImpact,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/lib/records/feedback-model";
import { formatDateTimeInTz } from "@/lib/time/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnimatedTabs } from "@/components/rareui/animated-tabs";
import { StateMessage } from "@/components/monitoring/states";
import { UserAvatar } from "@/components/users/user-avatar";

const STATUS_TONE: Record<FeedbackStatus, string> = {
  NUEVO: "bg-primary/15 text-primary",
  EN_REVISION: "bg-status-attention/15 text-status-attention-text",
  EN_PROCESO: "bg-status-alert/15 text-status-alert-text",
  RESUELTO: "bg-status-normal/15 text-status-normal-text",
  DESCARTADO: "bg-muted text-muted-foreground",
};

function StatusPill({ status }: { status: FeedbackStatus }) {
  return <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", STATUS_TONE[status])}>{FEEDBACK_STATUS_LABEL[status]}</span>;
}

function KindPill({ kind }: { kind: FeedbackKind }) {
  const Icon = kind === "BUG" ? Bug : Lightbulb;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold", kind === "BUG" ? "bg-status-critical/10 text-status-critical-text" : "bg-brand-teal/15 text-foreground")}>
      <Icon className="size-3" /> {FEEDBACK_KIND_LABEL[kind]}
    </span>
  );
}

export interface SectionOption {
  href: string;
  label: string;
}

/** Formulario para enviar un bug o una sugerencia (le llega solo al administrador). */
export function FeedbackForm({ sections, initialPage }: { sections: SectionOption[]; initialPage: string | null }) {
  const router = useRouter();
  const [kind, setKind] = useState<FeedbackKind>("BUG");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [page, setPage] = useState<string>(initialPage && sections.some((s) => s.href === initialPage) ? initialPage : "none");
  const [impact, setImpact] = useState<FeedbackImpact>("MEDIO");
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length >= 5 && description.trim().length >= 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title, description, page: page === "none" ? null : page, impact }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; message?: string };
      if (!res.ok || !d.ok) throw new Error(d.message ?? "No se pudo enviar.");
      sileo.success({ title: `Enviado al administrador · ${d.id}`, description: "Gracias: puedes ver su estado abajo en “Mis envíos”." });
      setTitle("");
      setDescription("");
      router.refresh();
    } catch (err) {
      sileo.error({ title: "No se pudo enviar", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <AnimatedTabs<FeedbackKind>
        label="Tipo de reporte"
        tabs={[
          { id: "BUG", label: "Reportar un bug" },
          { id: "SUGERENCIA", label: "Proponer una sugerencia" },
        ]}
        active={kind}
        onChange={setKind}
      />
      <div className="space-y-1">
        <Label htmlFor="fb-title">{kind === "BUG" ? "¿Qué falla?" : "¿Qué te gustaría mejorar?"}</Label>
        <Input id="fb-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder={kind === "BUG" ? "Ej. El mensaje de Monitoreos no muestra las conversiones de Meta" : "Ej. Agregar la comparación contra el mes anterior en Compare"} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="fb-desc">{kind === "BUG" ? "¿Qué hiciste, qué esperabas y qué pasó?" : "Cuéntanos la idea y para qué te serviría"}</Label>
        <Textarea id="fb-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={5} />
        <p className="text-[11px] text-muted-foreground">No incluyas contraseñas ni datos personales.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label>Sección</Label>
          <Select value={page} onValueChange={setPage}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">General / varias secciones</SelectItem>
              {sections.map((s) => (
                <SelectItem key={s.href} value={s.href}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label>{kind === "BUG" ? "Impacto" : "Prioridad"}</Label>
          <Select value={impact} onValueChange={(v) => setImpact(v as FeedbackImpact)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEEDBACK_IMPACTS.map((i) => (
                <SelectItem key={i} value={i}>
                  {FEEDBACK_IMPACT_LABEL[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Solo el administrador lo recibe y le da seguimiento.</p>
        <Button type="submit" disabled={!valid || busy}>
          <Send /> {busy ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </form>
  );
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Lista de reportes. Para el administrador es la bandeja completa con estado y respuesta; para
 * los demás, solo sus propios envíos (lectura).
 */
export function FeedbackList({ items, timezone, manage, sectionLabel }: { items: Feedback[]; timezone: string; manage: boolean; sectionLabel: Record<string, string> }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [kind, setKind] = useState<"all" | FeedbackKind>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { status: FeedbackStatus; note: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      items.filter(
        (f) =>
          (kind === "all" || f.kind === kind) &&
          (filter === "all" || (filter === "open" ? OPEN_FEEDBACK_STATUSES.includes(f.status) : !OPEN_FEEDBACK_STATUSES.includes(f.status))),
      ),
    [items, filter, kind],
  );
  const counts = {
    open: items.filter((f) => OPEN_FEEDBACK_STATUSES.includes(f.status)).length,
    done: items.filter((f) => !OPEN_FEEDBACK_STATUSES.includes(f.status)).length,
    all: items.length,
  };

  async function save(f: Feedback) {
    const d = draft[f.id] ?? { status: f.status, note: f.adminNote ?? "" };
    setBusy(f.id);
    try {
      const res = await fetch(`/api/feedback/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: d.status, adminNote: d.note.trim() || null }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !j.ok) throw new Error(j.message ?? "No se pudo guardar.");
      sileo.success({ title: `${f.id} actualizado` });
      router.refresh();
    } catch (err) {
      sileo.error({ title: "No se pudo guardar", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const head = ["Folio", "Tipo", "Estado", "Impacto", "Título", "Descripción", "Sección", "Enviado por", "Fecha", "Nota del administrador"];
    const lines = items.map((f) =>
      [f.id, FEEDBACK_KIND_LABEL[f.kind], FEEDBACK_STATUS_LABEL[f.status], FEEDBACK_IMPACT_LABEL[f.impact], f.title, f.description, f.page ? (sectionLabel[f.page] ?? f.page) : "", f.author.name, formatDateTimeInTz(f.createdAt, timezone), f.adminNote ?? ""]
        .map((v) => csvCell(String(v)))
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bugs-y-sugerencias-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!items.length) {
    return <StateMessage kind="empty" compact title={manage ? "Sin reportes todavía" : "Aún no has enviado nada"} description={manage ? "Cuando alguien envíe un bug o una sugerencia aparecerá aquí." : "Tus envíos y su estado aparecerán aquí."} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AnimatedTabs
            label="Estado"
            tabs={[
              { id: "open", label: "Abiertos", count: counts.open },
              { id: "done", label: "Cerrados", count: counts.done },
              { id: "all", label: "Todos", count: counts.all },
            ]}
            active={filter}
            onChange={setFilter}
          />
          <AnimatedTabs
            label="Tipo"
            tabs={[
              { id: "all", label: "Todo" },
              { id: "BUG", label: "Bugs" },
              { id: "SUGERENCIA", label: "Sugerencias" },
            ]}
            active={kind}
            onChange={setKind}
          />
        </div>
        {manage && (
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download /> CSV
          </Button>
        )}
      </div>
      {!rows.length && <StateMessage kind="empty" compact title="Nada en este filtro" description="Cambia el filtro para ver otros reportes." />}
      <ul className="space-y-2">
        {rows.map((f) => {
          const expanded = openId === f.id;
          const d = draft[f.id] ?? { status: f.status, note: f.adminNote ?? "" };
          return (
            <li key={f.id} className="surface rounded-xl">
              <button type="button" onClick={() => setOpenId(expanded ? null : f.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left" aria-expanded={expanded}>
                <UserAvatar name={f.author.name} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <KindPill kind={f.kind} />
                    <StatusPill status={f.status} />
                    <span className="tabular text-[11px] text-muted-foreground">{f.id}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold">{f.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {manage ? `${f.author.name} · ` : ""}
                    {formatDateTimeInTz(f.createdAt, timezone)}
                    {f.page ? ` · ${sectionLabel[f.page] ?? f.page}` : ""} · {f.kind === "BUG" ? "Impacto" : "Prioridad"} {FEEDBACK_IMPACT_LABEL[f.impact].toLowerCase()}
                  </span>
                </span>
              </button>
              {expanded && (
                <div className="space-y-3 border-t px-3 py-3 text-sm">
                  <p className="whitespace-pre-wrap">{f.description}</p>
                  {manage && f.agent && <p className="text-[11px] text-muted-foreground">Navegador: {f.agent}</p>}
                  {!manage && f.adminNote && (
                    <p className="rounded-md bg-muted/60 px-3 py-2 text-xs">
                      <span className="font-semibold">Respuesta del administrador:</span> {f.adminNote}
                    </p>
                  )}
                  {manage && (
                    <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
                      <div className="min-w-0 space-y-1">
                        <Label>Estado</Label>
                        <Select value={d.status} onValueChange={(v) => setDraft((x) => ({ ...x, [f.id]: { ...d, status: v as FeedbackStatus } }))}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FEEDBACK_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {FEEDBACK_STATUS_LABEL[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <Label htmlFor={`note-${f.id}`}>Nota o respuesta (la ve quien lo envió)</Label>
                        <Input id={`note-${f.id}`} value={d.note} maxLength={2000} onChange={(e) => setDraft((x) => ({ ...x, [f.id]: { ...d, note: e.target.value } }))} />
                      </div>
                      <Button size="sm" disabled={busy === f.id || (d.status === f.status && d.note.trim() === (f.adminNote ?? ""))} onClick={() => save(f)}>
                        {busy === f.id ? "Guardando…" : "Guardar"}
                      </Button>
                    </div>
                  )}
                  <ol className="space-y-1 border-l pl-3 text-[11px] text-muted-foreground">
                    {f.updates.map((u, i) => (
                      <li key={i}>
                        <span className="tabular">{formatDateTimeInTz(u.at, timezone)}</span> · {u.by}: {u.text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
