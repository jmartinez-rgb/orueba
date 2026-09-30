import type { ProviderStatus } from "../types/normalized.js";
import type { AdsProvider } from "../providers/provider.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { isApiError } from "../utils/errors.js";
import { withTimeout } from "../utils/timeout.js";

/**
 * Estado de todos los proveedores en paralelo. Un proveedor que falla o tarda no tumba la
 * respuesta: queda con estado "error" y el detalle del problema.
 */
export class ProviderStatusService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly timeoutMs: number,
  ) {}

  async one(provider: AdsProvider): Promise<ProviderStatus> {
    const started = Date.now();
    try {
      const s = await withTimeout(provider.status(), this.timeoutMs, provider.name);
      return { ...s, latency_ms: s.latency_ms ?? (s.state === "connected" ? Date.now() - started : null) };
    } catch (err) {
      const at = new Date().toISOString();
      return {
        provider: provider.slug,
        name: provider.name,
        state: "error",
        configured: provider.isConfigured(),
        implemented: provider.implemented,
        missing_config: [],
        last_successful_sync: null,
        last_error: {
          code: isApiError(err) ? err.code : "UNKNOWN",
          message: err instanceof Error ? err.message : String(err),
          at,
        },
        latency_ms: Date.now() - started,
        checked_at: at,
      };
    }
  }

  async all(): Promise<ProviderStatus[]> {
    const providers = this.registry.list();
    const settled = await Promise.allSettled(providers.map((p) => this.one(p)));
    return settled.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            provider: providers[i]!.slug,
            name: providers[i]!.name,
            state: "error" as const,
            configured: false,
            implemented: false,
            missing_config: [],
            last_successful_sync: null,
            last_error: { code: "UNKNOWN", message: String(r.reason), at: new Date().toISOString() },
            latency_ms: null,
            checked_at: new Date().toISOString(),
          },
    );
  }
}
