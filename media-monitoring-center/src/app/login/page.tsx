import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eye, LockKeyhole, ShieldCheck } from "lucide-react";
import { getAuthConfig } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/login-form";
import { FeatureBadge } from "@/components/rareui/feature-badge";

export const metadata: Metadata = { title: "Iniciar sesión" };
export const dynamic = "force-dynamic";

function safeNext(v: string | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const cfg = getAuthConfig();
  const session = await getSession();
  if (session.authenticated) redirect(target);

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#07080a] p-10 text-[#eceef1] lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#0b0c0f] ring-1 ring-white/10">
            <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
              <path d="M4 20 L10 20 L13 11 L17 25 L20 16 L28 16" fill="none" stroke="#00C1B5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="28" cy="16" r="2.4" fill="#D60270" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight">
              <span className="text-[#00C1B5]">izzi</span> Media
            </p>
            <p className="text-[11px] tracking-[0.14em] text-[#9aa0a8] uppercase">Monitoring Center</p>
          </div>
        </div>
        <div className="max-w-lg space-y-5">
          <h1 className="text-4xl leading-tight font-extrabold tracking-tight">¿Está todo izzi funcionando correctamente?</h1>
          <p className="text-sm leading-relaxed text-[#b6bcc5]">
            Monitoreo de Google, Meta, TikTok, Microsoft, Spotify y X comparando el mismo día de la semana y la misma franja horaria. Alertas, incidentes, tickets y el mensaje de monitoreo para
            WhatsApp en un solo lugar.
          </p>
          <ul className="space-y-2.5 text-sm text-[#d8dbe0]">
            <li className="flex items-start gap-2.5">
              <Eye className="mt-0.5 size-4 shrink-0 text-[#00C1B5]" /> Solo lectura: la plataforma no modifica campañas, presupuestos ni configuraciones en las plataformas.
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#00C1B5]" /> Cada acceso queda registrado con la persona, la hora y el dispositivo.
            </li>
            <li className="flex items-start gap-2.5">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#00C1B5]" /> Las credenciales viven en variables de entorno de Netlify, nunca en el código.
            </li>
          </ul>
        </div>
        <svg viewBox="0 0 600 120" className="pointer-events-none absolute right-0 bottom-24 left-0 w-full opacity-30" aria-hidden>
          <path d="M0 80 L120 80 L160 30 L210 110 L250 60 L330 60 L370 20 L420 95 L460 60 L600 60" fill="none" stroke="#00C1B5" strokeWidth="2" />
        </svg>
        <p className="relative text-[11px] text-[#7d838c]">Stragic · ABCW Global — uso interno.</p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 lg:hidden">
            <p className="text-lg font-extrabold tracking-tight">
              <span className="text-brand-teal">izzi</span> Media Monitoring Center
            </p>
          </div>
          <div className="space-y-2">
            <FeatureBadge badge="Solo lectura">Monitoreo sin cambios en plataformas</FeatureBadge>
            <h2 className="text-2xl font-bold tracking-tight">Iniciar sesión</h2>
            {cfg.mode === "password" && (
              <p className="text-sm text-muted-foreground">
                Usa tu <strong className="text-foreground">usuario</strong> si tienes cuenta. Si no, escribe tu <strong className="text-foreground">nombre y apellido</strong> y la contraseña universal del
                equipo.
              </p>
            )}
          </div>

          {cfg.mode === "password" && <LoginForm next={target} allowUniversal={Boolean(cfg.universalHash)} />}

          {cfg.mode === "locked" && (
            <div className="space-y-3 rounded-lg border border-status-attention/50 bg-status-attention/10 p-4 text-sm">
              <p className="font-semibold text-status-attention-text">El acceso todavía no está configurado.</p>
              <p className="text-muted-foreground">
                Para proteger el sitio, en producción nadie entra hasta que el administrador agregue en Netlify (<em>Site configuration → Environment variables</em>):
              </p>
              <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                <li>AUTH_SECRET</li>
                <li>AUTH_USERS</li>
                <li>AUTH_UNIVERSAL_PASSWORD_HASH</li>
              </ul>
              <p className="text-xs text-muted-foreground">Se generan con <code className="font-mono">npm run auth:setup</code>. Ver docs/AUTH.md.</p>
            </div>
          )}

          {(cfg.mode === "open" || cfg.mode === "header") && (
            <div className="space-y-3 rounded-lg border p-4 text-sm">
              <p className="text-muted-foreground">Este entorno no pide contraseña ({cfg.mode === "open" ? "acceso abierto de desarrollo" : "identidad corporativa"}).</p>
              <a href={target} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
                Entrar al monitoreo
              </a>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
