import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { POST as evaluate } from "@/app/api/monitoring/evaluate/route";

/** MONITORING_API_KEY: comparación de longitud fija para cualquier llave probada. Llave sintética. */

const mocks = vi.hoisted(() => ({ compared: [] as number[][], evaluate: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  const timingSafeEqual = (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
    mocks.compared.push([a.byteLength, b.byteLength]);
    return original.timingSafeEqual(a, b);
  };
  return { ...original, default: { ...original, timingSafeEqual }, timingSafeEqual };
});
vi.mock("@/lib/services/evaluate", () => ({ evaluateAllBrands: mocks.evaluate }));

const KEY = "fixture-scheduler-key-0123456789abcdef";

beforeEach(() => {
  mocks.compared.length = 0;
  mocks.evaluate.mockReset().mockResolvedValue([{ ok: true, brand: "izzi" }]);
  vi.stubEnv("MONITORING_API_KEY", KEY);
  vi.stubEnv("DATA_SOURCE", "unified");
  vi.stubEnv("LOG_LEVEL", "silent");
  resetEnvCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

const call = (headers: Record<string, string>) =>
  evaluate(new Request("http://monitor.test/api/monitoring/evaluate", { method: "POST", headers, body: JSON.stringify({ dryRun: true }) }));

describe("llave del endpoint programado", () => {
  it.each([
    ["vacía", {}],
    ["corta", { authorization: "Bearer x" }],
    ["un carácter menos", { authorization: `Bearer ${KEY.slice(0, -1)}` }],
    ["más larga", { "x-api-key": `${KEY}0` }],
    ["sin prefijo Bearer", { authorization: KEY }],
  ])("llave %s → 401, comparada con huellas de igual longitud", async (_name, headers) => {
    expect((await call(headers)).status).toBe(401);
    expect(mocks.compared).toEqual([[32, 32]]);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{ authorization: `Bearer ${KEY}` }, { "x-api-key": KEY }])("acepta la llave configurada: %j", async (headers) => {
    expect((await call(headers)).status).toBe(200);
    expect(mocks.evaluate).toHaveBeenCalledWith({ dryRun: true, trigger: "schedule" });
  });

  it("la respuesta de rechazo no revela la llave ni detalles", async () => {
    const body = await (await call({ "x-api-key": "otra" })).text();
    expect(body).not.toContain(KEY);
    expect(JSON.parse(body)).toEqual({ ok: false, message: "No autorizado." });
  });
});
