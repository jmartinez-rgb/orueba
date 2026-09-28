"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { sileo } from "sileo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/users/user-avatar";
import { ShimmerButton } from "@/components/rareui/shimmer-button";
import { LoadingSpinner } from "@/components/rareui/loading-spinner";

export function LoginForm({ next, allowUniversal }: { next: string; allowUniversal: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; user?: { name: string } };
      if (!res.ok || !d.ok) {
        setError(d.message ?? "No se pudo iniciar sesión.");
        setPassword("");
        return;
      }
      sileo.success({ title: `Hola, ${d.user?.name ?? ""}`.trim(), description: "Acceso registrado en la bitácora." });
      router.replace(next);
      router.refresh();
    } catch {
      setError("No se pudo contactar al servidor. Revisa tu conexión.");
    } finally {
      setBusy(false);
    }
  }

  const preview = username.trim();
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <UserAvatar name={preview || "izzi"} size={48} animate />
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="truncate text-sm font-semibold text-foreground">{preview || "Tu avatar"}</p>
          <p>Se genera a partir de tu nombre y te identifica en la bitácora.</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-user">{allowUniversal ? "Usuario o nombre y apellido" : "Usuario"}</Label>
        <Input id="login-user" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={allowUniversal ? "jmartinez · o · Ana López" : "jmartinez"} required maxLength={60} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-pass">Contraseña</Label>
        <div className="relative">
          <Input id="login-pass" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200} className="pr-10" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-xs font-medium text-status-critical-text">
          {error}
        </p>
      )}
      <ShimmerButton type="submit" className="w-full" disabled={busy || !username.trim() || !password}>
        {busy ? (
          <>
            <LoadingSpinner label={null} size={16} /> Validando…
          </>
        ) : (
          <>
            Entrar <ArrowRight className="size-4" />
          </>
        )}
      </ShimmerButton>
      <p className="text-center text-[11px] text-muted-foreground">Tras 5 intentos fallidos el acceso se bloquea 10 minutos.</p>
    </form>
  );
}
