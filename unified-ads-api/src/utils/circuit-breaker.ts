import { ApiError } from "./errors.js";
import { isRetryable } from "./retry.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Fallos seguidos para abrir el circuito. */
  failureThreshold: number;
  /** Tiempo abierto antes de permitir una prueba (HALF_OPEN). */
  resetTimeoutMs: number;
  /** Qué errores cuentan como falla del proveedor (por omisión, los transitorios: 429, 5xx, red). */
  isFailure?: (err: unknown) => boolean;
  now?: () => number;
}

/**
 * Evita bombardear a un proveedor caído: tras N fallos seguidos se abre y responde de inmediato
 * con PROVIDER_ERROR; pasado el tiempo de espera deja pasar una prueba y, si sale bien, se cierra.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly opts: CircuitBreakerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get current(): CircuitState {
    if (this.state === "OPEN" && this.now() - this.openedAt >= this.opts.resetTimeoutMs) this.state = "HALF_OPEN";
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.current === "OPEN") {
      const wait = Math.ceil((this.opts.resetTimeoutMs - (this.now() - this.openedAt)) / 1000);
      throw new ApiError("PROVIDER_ERROR", `${this.name} falla de forma repetida: se pausan las consultas ${wait} s.`, {
        details: { circuit: "OPEN" },
        retryAfter: wait,
      });
    }
    try {
      const result = await fn();
      this.state = "CLOSED";
      this.failures = 0;
      return result;
    } catch (err) {
      // Un error de la solicitud (400, 401, 403) no dice que el proveedor esté caído.
      if (!(this.opts.isFailure ?? isRetryable)(err)) throw err;
      this.failures++;
      if (this.state === "HALF_OPEN" || this.failures >= this.opts.failureThreshold) {
        this.state = "OPEN";
        this.openedAt = this.now();
      }
      throw err;
    }
  }
}
