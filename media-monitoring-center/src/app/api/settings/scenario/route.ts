import { cookies } from "next/headers";
import { getEnv } from "@/lib/config/env";
import { SCENARIOS } from "@/lib/mock/scenarios";
import { SCENARIO_COOKIE } from "@/lib/services/context";
import { invalidate } from "@/lib/data/cache";
import { badRequest, forbidden, json, readJson } from "@/lib/services/http";

export const dynamic = "force-dynamic";

/** MOCK MODE: cambia el escenario simulado (por navegador). */
export async function POST(req: Request) {
  if (!getEnv().useMockData) return forbidden("Los escenarios solo existen en MOCK MODE.");
  const body = await readJson<{ scenario?: string }>(req);
  if (!body?.scenario || !SCENARIOS[body.scenario]) return badRequest("Escenario inválido.");
  const c = await cookies();
  c.set(SCENARIO_COOKIE, body.scenario, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  invalidate("live:");
  return json({ ok: true, scenario: body.scenario });
}
