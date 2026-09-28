"use client";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const serverSeconds = () => 0;

function useNowSeconds() {
  return useSyncExternalStore(subscribe, nowSeconds, serverSeconds);
}

function fmt(d: Date, tz: string, withSeconds: boolean) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined, hourCycle: "h23" }).format(d);
}

/** Reloj en la zona horaria de negocio (no la del navegador). */
export function LiveClock({ timezone, className, seconds = true }: { timezone: string; className?: string; seconds?: boolean }) {
  const s = useNowSeconds();
  return <span className={className}>{s ? fmt(new Date(s * 1000), timezone, seconds) : "--:--"}</span>;
}

/** Cuenta regresiva hasta la próxima evaluación. */
export function Countdown({ target, className }: { target: string; className?: string }) {
  const s = useNowSeconds();
  if (!s) return <span className={className}>—</span>;
  const left = Math.max(0, Date.parse(target) - s * 1000);
  const m = Math.floor(left / 60000);
  const h = Math.floor(m / 60);
  return <span className={className}>{h > 0 ? `${h} h ${m % 60} min` : `${m} min`}</span>;
}
