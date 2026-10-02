export type { GoogleDomainConfig } from "./config";
export type { DomainMetadata } from "@/lib/types";
export interface DomainSelection {
  id: string;
  name: string;
  available: boolean;
  configVersion: number | null;
}
