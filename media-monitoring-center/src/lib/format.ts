import type { MetricId } from "@/lib/types";
import { METRICS } from "@/lib/metrics";

const currency0 = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const currency2 = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

export function fmtCurrency(v: number | null | undefined, opts?: { compact?: boolean; decimals?: boolean }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (opts?.compact && Math.abs(v) >= 10000) return `$${compact.format(v)}`;
  if (opts?.decimals || Math.abs(v) < 100) return currency2.format(v);
  return currency0.format(v);
}

export function fmtNumber(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (opts?.compact && Math.abs(v) >= 10000) return compact.format(v);
  return integer.format(v);
}

/** Variación con signo: +12.3% / −8.0%. */
export function fmtDelta(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = (Math.abs(v) * 100).toFixed(digits);
  if (Number(s) === 0) return `0.${"0".repeat(digits)}%`;
  return `${v > 0 ? "+" : "−"}${s}%`;
}

export function fmtPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtMetric(metric: MetricId, v: number | null | undefined, opts?: { compact?: boolean }): string {
  const def = METRICS[metric];
  switch (def.format) {
    case "currency":
      return fmtCurrency(v, { compact: opts?.compact, decimals: metric === "cpc" || metric === "cpm" || metric === "cpr" || metric === "cpa" || metric === "cpl" ? (v ?? 0) < 1000 : false });
    case "percent":
      return fmtPercent(v, 2);
    case "ratio":
      return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`;
    default:
      return fmtNumber(v, opts);
  }
}

/** Oculta la mayor parte de un teléfono o correo para mostrarlo en pantalla. */
export function maskAddress(address: string): string {
  if (address.includes("@")) {
    const [user, domain] = address.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }
  const digits = address.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `+${digits.slice(0, 2)} *** *** ${digits.slice(-4)}`;
}
