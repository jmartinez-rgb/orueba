import type { BrandId } from "@/lib/brands";
import type { EffectiveAccount } from "@/lib/auth/users";
import type { Session } from "@/lib/auth/session";
import type { Incident } from "./types";

export interface IncidentAssignee { id: string; name: string }

/** Solo identidades nominales capaces de atender la marca; nunca hashes ni permisos privados. */
export function eligibleAssignees(accounts: EffectiveAccount[], brand: BrandId): IncidentAssignee[] {
  return accounts.filter(a => a.active && a.role !== "client" && a.role !== "auditor" && a.permissions.includes("internal:view") && a.permissions.includes("incidents:write") && (!a.brands.length || a.brands.includes(brand)))
    .map(a => ({ id: a.username, name: a.name }));
}

export function canAssignIncident(session: Pick<Session, "authenticated" | "permissions">): boolean {
  return session.authenticated && session.permissions.includes("internal:view") && session.permissions.includes("incidents:assign") && session.permissions.includes("incidents:write");
}

export function assignedTo(incident: Pick<Incident, "ownerId">, userId: string | null | undefined): boolean {
  return Boolean(userId && incident.ownerId === userId);
}
