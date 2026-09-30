import { ApiError } from "./errors.js";

/** Corta una operación que tarda más de `ms` con PROVIDER_TIMEOUT. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ApiError("PROVIDER_TIMEOUT", `${label} no respondió en ${Math.round(ms / 1000)} s.`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
