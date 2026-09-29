"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { sileo } from "sileo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** La persona cambia su propia contraseña. Sus sesiones en otros dispositivos se cierran. */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok || !data?.ok) return sileo.error({ title: "No se pudo cambiar", description: data?.message ?? "Intenta de nuevo." });
    sileo.success({ title: "Contraseña actualizada", description: "Tus sesiones en otros dispositivos se cerraron." });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar mi contraseña</DialogTitle>
          <DialogDescription>Mínimo 10 caracteres, con letras y números.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pw-current">Contraseña actual</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-next">Contraseña nueva</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">Repite la contraseña nueva</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
            {mismatch && <p className="text-xs text-status-alert-text">No coincide con la contraseña nueva.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !current || next.length < 10 || next !== confirm}>
            {saving && <Loader2 className="animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
