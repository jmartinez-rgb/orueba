export class SmokeOptionsError extends Error {
  constructor() {
    super("INVALID_SMOKE_OPTIONS");
  }
}

/** Explicit public URLs only. Never read configuration files or credentials. */
export function parseSmokeOptions(args: string[]) {
  const options: { monitorUrl?: string; apiUrl?: string; timeoutMs?: number; help: boolean } = { help: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new SmokeOptionsError();
    seen.add(flag);
    if (flag === "--help" || flag === "--ayuda") {
      options.help = true;
      continue;
    }
    if (!["--monitor", "--api", "--timeout-ms"].includes(flag)) throw new SmokeOptionsError();
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new SmokeOptionsError();
    if (flag === "--timeout-ms") {
      if (!/^\d+$/.test(value)) throw new SmokeOptionsError();
      const timeout = Number(value);
      if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 15000) throw new SmokeOptionsError();
      options.timeoutMs = timeout;
    } else if (flag === "--monitor") options.monitorUrl = value;
    else options.apiUrl = value;
  }
  return options;
}
