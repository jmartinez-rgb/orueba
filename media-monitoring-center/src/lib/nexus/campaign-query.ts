import { PLATFORM_IDS, type PlatformId } from "@/lib/types";

/** URL filters are display hints; catalog/session authorization still controls actual rows. */
export function campaignQuery(query: { search?: unknown; platform?: unknown }): { initialSearch: string; initialPlatform: PlatformId | undefined } {
  const initialSearch = typeof query.search === "string" ? query.search.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, 160) : "";
  const initialPlatform = typeof query.platform === "string" && PLATFORM_IDS.includes(query.platform as PlatformId) ? query.platform as PlatformId : undefined;
  return { initialSearch, initialPlatform };
}
