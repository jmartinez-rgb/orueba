"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Trash2, UserCog, UserRoundX, UserRoundCheck } from "lucide-react";
import { sileo } from "sileo";
import { BRAND_IDS, BRANDS, type BrandId } from "@/lib/brands";
import { PERMISSION_LABEL, PERMISSIONS, permissionsOf, ROLE_LABEL, ROLES, type Permission, type Role } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";

export interface AccountRow {
  username: string;
  name: string;
  role: Role;
  permissions: Permission[];
  customPermissions: boolean;
  brands: BrandId[];
  active: boolean;
  source: "netlify" | "app" | "netlify+app";
  passwordChangedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UniversalRow {
  enabled: boolean;
  role: Role;
  brands: BrandId[];
  source: "netlify" | "app" | "none";
}

const SOURCE_LABEL: Record<AccountRow["source"], string> = { netlify: "Netlify", app: "App", "netlify+app": "Netlify · editada en la app" };

/** Contraseña aleatoria legible (sin 0/O, 1/l/I): Mmc-XXXX-XXXX-XXXX. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length);
  for (;;) {
    const chars: string[] = [];
    while (chars.length < 12) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < limit && chars.length < 12) chars.push(alphabet[b % alphabet.length]);
    const body = chars.join("");
    // Siempre con letras y números (la regla mínima de contraseña).
    if (/\d/.test(body) && /[a-zA-Z]/.test(body)) return `Mmc-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
  }
}

function suggestUsername(name: string): string {
  const parts = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1]}` : parts[0]).slice(0, 40);
}

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; [k: string]: unknown }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok || !data?.ok) return { ok: false, message: data?.message ?? "No se pudo completar la acción." };
  return data;
}

function BrandBadges({ brands }: { brands: BrandId[] }) {
  if (!brands.length) return <span className="text-xs text-muted-foreground">Todas</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {brands.map((b) => (
        <span key={b} className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: BRANDS[b].color, color: BRANDS[b].ink }}>
          {BRANDS[b].name}
        </span>
      ))}
    </span>
  );
}

function BrandPicker({ value, onChange, disabled }: { value: BrandId[]; onChange: (v: BrandId[]) => void; disabled?: boolean }) {
  const all = !value.length;
  const selected = (b: BrandId) => all || value.includes(b);
  const toggle = (b: BrandId) => {
    const cur = all ? [...BRAND_IDS] : value;
    const next = cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b];
    if (!next.length) return; // al menos una marca
    onChange(next.length === BRAND_IDS.length ? [] : next);
  };
  return (
    <div className="flex gap-2">
      {BRAND_IDS.map((b) => (
        <button
          key={b}
          type="button"
          disabled={disabled}
          onClick={() => toggle(b)}
          aria-pressed={selected(b)}
          className={cn("flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors disabled:opacity-50", selected(b) ? "border-transparent" : "bg-transparent text-muted-foreground")}
          style={selected(b) ? { backgroundColor: BRANDS[b].color, color: BRANDS[b].ink } : { backgroundColor: "transparent" }}
        >
          {selected(b) && <Check className="size-3.5" />}
          {BRANDS[b].name}
        </button>
      ))}
    </div>
  );
}

function PermissionPicker({ role, custom, value, onCustom, onChange, grantable, disabled }: { role: Role; custom: boolean; value: Permission[]; onCustom: (v: boolean) => void; onChange: (v: Permission[]) => void; grantable: Permission[]; disabled?: boolean }) {
  const shown = custom ? value : permissionsOf(role);
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span className="text-sm">
          <span className="font-medium">Permisos personalizados</span>
          <span className="block text-xs text-muted-foreground">{custom ? "Esta persona tiene exactamente los permisos marcados." : `Usa los permisos del rol ${ROLE_LABEL[role]}.`}</span>
        </span>
        <Switch
          checked={custom}
          disabled={disabled}
          onCheckedChange={(v) => {
            onCustom(v);
            if (v) onChange(permissionsOf(role).filter((p) => grantable.includes(p)));
          }}
        />
      </label>
      <div className="grid max-h-64 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
        {PERMISSIONS.map((p) => {
          const on = shown.includes(p);
          const locked = disabled || !custom || !grantable.includes(p);
          return (
            <label key={p} className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5", on ? "border-brand-teal/50 bg-brand-teal/5" : "", locked && "cursor-default opacity-70")} title={!grantable.includes(p) ? "No puedes dar un permiso que tú no tienes." : undefined}>
              <input type="checkbox" className="mt-0.5 accent-[var(--brand-teal)]" checked={on} disabled={locked} onChange={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])} />
              <span className="min-w-0">
                <span className="block text-[13px] leading-tight font-medium">{PERMISSION_LABEL[p].title}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{PERMISSION_LABEL[p].detail}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Mínimo 10 caracteres, letras y números" autoComplete="new-password" spellCheck={false} className="font-mono" autoFocus={autoFocus} />
      <Button type="button" variant="outline" onClick={() => onChange(generatePassword())} title="Generar una contraseña segura">
        <RefreshCw /> Generar
      </Button>
    </div>
  );
}

/** Muestra una contraseña recién guardada una sola vez, con botón para copiar. */
function RevealPassword({ label, password, onClose }: { label: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contraseña guardada</DialogTitle>
          <DialogDescription>{label} Cópiala ahora y compártela por un canal seguro: no se vuelve a mostrar.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
          <code className="flex-1 font-mono text-sm break-all">{password}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(password).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copiada" : "Copiar"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Editing = { kind: "create" } | { kind: "edit"; account: AccountRow } | { kind: "password"; account: AccountRow } | { kind: "universal" } | null;

export function AccountAdmin({ initialAccounts, initialUniversal, selfId, myPermissions }: { initialAccounts: AccountRow[]; initialUniversal: UniversalRow; selfId: string; myPermissions: Permission[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [universal, setUniversal] = useState(initialUniversal);
  const [editing, setEditing] = useState<Editing>(null);
  const [reveal, setReveal] = useState<{ label: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // Relee las cuentas y refresca la página (bitácora y resumen de acceso).
  const reload = async () => {
    const data = await send("/api/users", "GET");
    if (data.ok) {
      setAccounts(data.accounts as AccountRow[]);
      setUniversal(data.universal as UniversalRow);
    }
    router.refresh();
  };

  const toggleActive = async (a: AccountRow) => {
    setBusy(true);
    const res = await send(`/api/users/${encodeURIComponent(a.username)}`, "PATCH", { active: !a.active });
    setBusy(false);
    if (!res.ok) return sileo.error({ title: "No se pudo cambiar el estado", description: res.message });
    sileo.success({ title: a.active ? `${a.name} ya no puede entrar` : `${a.name} puede volver a entrar`, description: a.active ? "Sus sesiones abiertas se cerraron." : undefined });
    await reload();
  };

  const remove = async (a: AccountRow) => {
    const reverts = a.source === "netlify+app";
    if (!window.confirm(reverts ? `¿Quitar los cambios hechos en la app a ${a.name}? Volverá a la cuenta configurada en Netlify.` : `¿Eliminar la cuenta de ${a.name}? No podrá volver a entrar.`)) return;
    setBusy(true);
    const res = await send(`/api/users/${encodeURIComponent(a.username)}`, "DELETE");
    setBusy(false);
    if (!res.ok) return sileo.error({ title: "No se pudo eliminar", description: res.message });
    sileo.success({ title: reverts ? "Cuenta restaurada a la de Netlify" : "Cuenta eliminada" });
    await reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Las contraseñas se guardan cifradas (scrypt); nadie, ni el administrador, puede verlas después de guardarlas.</p>
        <Button size="sm" onClick={() => setEditing({ kind: "create" })}>
          <Plus /> Nueva cuenta
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Persona</th>
              <th className="px-3 py-2 font-semibold">Rol</th>
              <th className="px-3 py-2 font-semibold">Permisos</th>
              <th className="px-3 py-2 font-semibold">Marcas</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 font-semibold">Origen</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const self = a.username === selfId;
              return (
                <tr key={a.username} className={cn("border-t", !a.active && "opacity-60")}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={a.name} size={30} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {a.name} {self && <span className="text-xs font-normal text-muted-foreground">(tú)</span>}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">{a.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold">{ROLE_LABEL[a.role]}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{a.customPermissions ? <span className="font-medium text-brand-teal">Personalizados ({a.permissions.length})</span> : <span className="text-muted-foreground">Los del rol ({a.permissions.length})</span>}</td>
                  <td className="px-3 py-2">
                    <BrandBadges brands={a.brands} />
                  </td>
                  <td className="px-3 py-2 text-xs">{a.active ? <span className="font-medium text-status-normal-text">Activa</span> : <span className="font-medium text-status-alert-text">Desactivada</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{SOURCE_LABEL[a.source]}</td>
                  <td className="px-3 py-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${a.name}`} disabled={busy}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing({ kind: "edit", account: a })}>
                          <UserCog /> Editar rol, permisos y marcas
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing({ kind: "password", account: a })}>
                          <KeyRound /> Asignar contraseña
                        </DropdownMenuItem>
                        {!self && (
                          <DropdownMenuItem onSelect={() => toggleActive(a)}>
                            {a.active ? <UserRoundX /> : <UserRoundCheck />} {a.active ? "Desactivar" : "Activar"}
                          </DropdownMenuItem>
                        )}
                        {!self && a.source !== "netlify" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => remove(a)} className="text-status-alert-text">
                              <Trash2 /> {a.source === "netlify+app" ? "Quitar cambios de la app" : "Eliminar cuenta"}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <div className="flex items-center gap-3">
          <ShieldCheck className={cn("size-5", universal.enabled ? "text-brand-teal" : "text-muted-foreground")} />
          <div>
            <p className="text-sm font-semibold">Contraseña universal</p>
            <p className="text-xs text-muted-foreground">
              {universal.enabled ? `Activa · ${ROLE_LABEL[universal.role]} · cada persona entra con su nombre y apellido` : "Desactivada: solo entran las cuentas con usuario."}
              {universal.source === "netlify" && universal.enabled ? " · configurada en Netlify" : ""}
            </p>
          </div>
          <BrandBadges brands={universal.brands} />
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "universal" })}>
          <KeyRound /> Configurar
        </Button>
      </div>

      {editing?.kind === "create" && (
        <AccountDialog
          mode="create"
          grantable={myPermissions}
          onClose={() => setEditing(null)}
          onSaved={async (password, name) => {
            setEditing(null);
            await reload();
            if (password) setReveal({ label: `Cuenta de ${name} creada.`, password });
          }}
        />
      )}
      {editing?.kind === "edit" && (
        <AccountDialog
          mode="edit"
          account={editing.account}
          self={editing.account.username === selfId}
          grantable={myPermissions}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
      {editing?.kind === "password" && (
        <PasswordDialog
          account={editing.account}
          onClose={() => setEditing(null)}
          onSaved={async (password) => {
            const name = editing.account.name;
            setEditing(null);
            await reload();
            setReveal({ label: `Nueva contraseña de ${name}. Sus sesiones abiertas se cerraron.`, password });
          }}
        />
      )}
      {editing?.kind === "universal" && (
        <UniversalDialog
          universal={universal}
          onClose={() => setEditing(null)}
          onSaved={async (password) => {
            setEditing(null);
            await reload();
            if (password) setReveal({ label: "Nueva contraseña universal. Quien entró con la anterior tendrá que volver a entrar.", password });
          }}
        />
      )}
      {reveal && <RevealPassword label={reveal.label} password={reveal.password} onClose={() => setReveal(null)} />}
    </div>
  );
}

function AccountDialog({ mode, account, self, grantable, onClose, onSaved }: { mode: "create" | "edit"; account?: AccountRow; self?: boolean; grantable: Permission[]; onClose: () => void; onSaved: (password: string | null, name: string) => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [username, setUsername] = useState(account?.username ?? "");
  const [touchedUser, setTouchedUser] = useState(false);
  const [role, setRole] = useState<Role>(account?.role ?? "viewer");
  const [custom, setCustom] = useState(account?.customPermissions ?? false);
  const [permissions, setPermissions] = useState<Permission[]>(account?.permissions ?? permissionsOf("viewer"));
  const [brands, setBrands] = useState<BrandId[]>(account?.brands ?? []);
  const [password, setPassword] = useState(mode === "create" ? generatePassword() : "");
  const [saving, setSaving] = useState(false);
  const lockAccess = Boolean(self);

  const save = async () => {
    setSaving(true);
    const body =
      mode === "create"
        ? { username, name, role, permissions: custom ? permissions : null, brands, password }
        : { name, brands, ...(lockAccess ? {} : { role, permissions: custom ? permissions : null }) };
    const res = await send(mode === "create" ? "/api/users" : `/api/users/${encodeURIComponent(account!.username)}`, mode === "create" ? "POST" : "PATCH", body);
    setSaving(false);
    if (!res.ok) return sileo.error({ title: "No se pudo guardar", description: res.message });
    sileo.success({ title: mode === "create" ? "Cuenta creada" : "Cambios guardados", description: mode === "edit" ? "Aplican desde la siguiente página que abra la persona." : undefined });
    onSaved(mode === "create" ? password : null, name);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nueva cuenta" : `Editar a ${account!.name}`}</DialogTitle>
          <DialogDescription>{mode === "create" ? "La persona entra con su usuario y la contraseña que asignes aquí." : lockAccess ? "Puedes cambiar tu nombre y marcas; tu rol y permisos los cambia otro administrador." : "Los cambios aplican de inmediato."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Nombre visible</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (mode === "create" && !touchedUser) setUsername(suggestUsername(e.target.value));
              }}
              placeholder="Ana López"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-user">Usuario</Label>
            <Input
              id="acc-user"
              value={username}
              disabled={mode === "edit"}
              onChange={(e) => {
                setTouchedUser(true);
                setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""));
              }}
              placeholder="alopez"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Rol</Label>
            <Select
              value={role}
              disabled={lockAccess}
              onValueChange={(v) => {
                setRole(v as Role);
                if (!custom) setPermissions(permissionsOf(v as Role));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} disabled={permissionsOf(r).some((p) => !grantable.includes(p))}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Marcas que puede ver</Label>
            <BrandPicker value={brands} onChange={setBrands} />
          </div>
        </div>
        <PermissionPicker role={role} custom={custom} value={permissions} onCustom={setCustom} onChange={setPermissions} grantable={grantable} disabled={lockAccess} />
        {mode === "create" && (
          <div className="space-y-1.5">
            <Label>Contraseña inicial</Label>
            <PasswordField value={password} onChange={setPassword} />
            <p className="text-[11px] text-muted-foreground">Se muestra una sola vez al guardar. La persona puede cambiarla después desde su menú.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || name.trim().length < 3 || (mode === "create" && (username.length < 3 || password.length < 10))}>
            {saving && <Loader2 className="animate-spin" />} {mode === "create" ? "Crear cuenta" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ account, onClose, onSaved }: { account: AccountRow; onClose: () => void; onSaved: (password: string) => void }) {
  const [password, setPassword] = useState(generatePassword());
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const res = await send(`/api/users/${encodeURIComponent(account.username)}`, "PATCH", { password });
    setSaving(false);
    if (!res.ok) return sileo.error({ title: "No se pudo guardar", description: res.message });
    onSaved(password);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contraseña de {account.name}</DialogTitle>
          <DialogDescription>Escribe una o genera una segura. Al guardarla se cierran las sesiones abiertas de {account.name}.</DialogDescription>
        </DialogHeader>
        <PasswordField value={password} onChange={setPassword} autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || password.length < 10}>
            {saving && <Loader2 className="animate-spin" />} Guardar contraseña
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UniversalDialog({ universal, onClose, onSaved }: { universal: UniversalRow; onClose: () => void; onSaved: (password: string | null) => void }) {
  const [enabled, setEnabled] = useState(universal.enabled || universal.source === "none");
  const [role, setRole] = useState<"viewer" | "manager">(universal.role === "manager" ? "manager" : "viewer");
  const [brands, setBrands] = useState<BrandId[]>(universal.brands);
  const [changePassword, setChangePassword] = useState(universal.source === "none");
  const [password, setPassword] = useState(universal.source === "none" ? generatePassword() : "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const res = await send("/api/users/universal", "PUT", { enabled, role, brands, ...(changePassword ? { password } : {}) });
    setSaving(false);
    if (!res.ok) return sileo.error({ title: "No se pudo guardar", description: res.message });
    sileo.success({ title: enabled ? "Contraseña universal actualizada" : "Contraseña universal desactivada" });
    onSaved(changePassword ? password : null);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contraseña universal</DialogTitle>
          <DialogDescription>Una sola contraseña para el equipo: cada persona entra escribiendo su nombre y apellido. Nunca da acceso de administrador.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span className="font-medium">Permitir entrar con la contraseña universal</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Rol de quien entra así</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "viewer" | "manager")} disabled={!enabled}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
                <SelectItem value="manager">{ROLE_LABEL.manager}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Marcas que puede ver</Label>
            <BrandPicker value={brands} onChange={setBrands} disabled={!enabled} />
          </div>
        </div>
        <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span className="font-medium">Cambiar la contraseña universal</span>
          <Switch
            checked={changePassword}
            disabled={!enabled}
            onCheckedChange={(v) => {
              setChangePassword(v);
              if (v && !password) setPassword(generatePassword());
            }}
          />
        </label>
        {changePassword && enabled && <PasswordField value={password} onChange={setPassword} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || (changePassword && enabled && password.length < 10)}>
            {saving && <Loader2 className="animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
