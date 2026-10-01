export interface GoogleCustomer {
  id?: string;
  descriptiveName?: string;
  currencyCode?: string;
  timeZone?: string;
  manager?: boolean;
  status?: string;
}

export interface GoogleRow {
  customer?: GoogleCustomer;
  customerClient?: GoogleCustomer & { clientCustomer?: string; level?: string | number };
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
  segments?: {
    date?: string;
    hour?: number;
    conversionAction?: string;
    conversionActionName?: string;
    conversionActionCategory?: string;
  };
  metrics?: Record<string, unknown>;
}

export type GoogleFetch = typeof fetch;

export function googleNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n)) ? n : null;
}
