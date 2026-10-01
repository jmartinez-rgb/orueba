import { z } from "zod";
import { PROVIDER_SLUGS, type ProviderSlug } from "../types/providers.js";
import { metaAccountId } from "../providers/meta/config.js";

export function verificationArgs(argv: string[]) {
  const out = {
    help: false,
    providers: [...PROVIDER_SLUGS],
    accounts: {} as Record<string, string[]>,
    date: undefined as string | undefined,
    output: undefined as string | undefined,
    maxAccounts: 25,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "--ayuda") {
      out.help = true;
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error("Falta el valor de una opción.");
    if (arg === "--proveedores") {
      const selected = value.split(",");
      if (selected.some((p) => !PROVIDER_SLUGS.includes(p as ProviderSlug))) throw new Error("Proveedor desconocido.");
      out.providers = [...new Set(selected)] as ProviderSlug[];
    } else if (arg === "--fecha") {
      if (!z.iso.date().safeParse(value).success) throw new Error("Fecha inválida; usa YYYY-MM-DD.");
      out.date = value;
    } else if (arg === "--salida") {
      if (!value.toLowerCase().endsWith(".xlsx")) throw new Error("La salida debe ser .xlsx.");
      out.output = value;
    } else if (arg === "--limite-cuentas") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000)
        throw new Error("Límite de cuentas inválido (1–1000).");
      out.maxAccounts = Number(value);
    } else if (arg === "--cuentas") {
      const match = /^([a-z]+):([A-Za-z0-9_,]+)$/.exec(value);
      if (!match || !PROVIDER_SLUGS.includes(match[1] as ProviderSlug))
        throw new Error("Usa --cuentas plataforma:ID,ID.");
      const provider = match[1]!,
        ids = match[2]!.split(",");
      if (ids.some((id) => !id || id.length > 80)) throw new Error("ID de cuenta inválido.");
      out.accounts[provider] = [
        ...new Set([
          ...(out.accounts[provider] ?? []),
          ...ids.map((id) => (provider === "meta" ? metaAccountId(id) : id)),
        ]),
      ];
    } else throw new Error("Opción desconocida; usa --ayuda.");
  }
  if (Object.keys(out.accounts).some((p) => !out.providers.includes(p as ProviderSlug)))
    throw new Error("Hay cuentas de un proveedor no seleccionado.");
  return out;
}
