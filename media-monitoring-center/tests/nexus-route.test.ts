import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/nexus/route";
import { nexusSnapshot } from "./nexus-fixtures";

const mocks = vi.hoisted(() => ({ session: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session, hasPermission: (session: { authenticated: boolean; permissions: string[] }, permission: string) => session.authenticated && session.permissions.includes(permission) }));
vi.mock("@/lib/services/snapshot", () => ({ getSnapshot: mocks.snapshot }));
let user = 0;
const request = (body: unknown) => new Request("http://localhost/api/nexus", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ authenticated: true, role: "manager", permissions: ["internal:view"], brands: ["izzi"], user: { id: `nexus-user-${++user}` } });
  mocks.snapshot.mockResolvedValue(nexusSnapshot());
});

describe("Nexus API", () => {
  it("requires authentication before reading a body or the snapshot", async () => {
    mocks.session.mockResolvedValue({ authenticated: false });
    const response = await POST(request({ question: "Resumen", brand: "izzi" }));
    expect(response.status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("rejects clients even with an incompatible internal permission, and internal users without permission", async () => {
    for (const session of [
      { authenticated: true, role: "client", permissions: ["internal:view"] },
      { authenticated: true, role: "manager", permissions: [] },
    ]) {
      mocks.session.mockResolvedValue(session);
      expect((await POST(request({ question: "Resumen", brand: "izzi" }))).status).toBe(403);
    }
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("rejects unauthorized brand access and stale-tab brand changes without leaking the other brand", async () => {
    expect((await POST(request({ question: "Resumen", brand: "sky" }))).status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    const snapshot = nexusSnapshot(); snapshot.meta.brand.id = "sky";
    mocks.snapshot.mockResolvedValue(snapshot);
    const response = await POST(request({ question: "Resumen", brand: "izzi" }));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toMatch(/Foreign|PRIVATE/);
  });

  it("rejects stale domain selections, including legacy all-scope tabs, without returning data", async () => {
    const snapshot = nexusSnapshot();
    snapshot.meta.domain = { id: "fixture_domain", name: "Dominio de prueba", available: true, configVersion: 3 };
    mocks.snapshot.mockResolvedValue(snapshot);
    for (const domain of [undefined, "all", "another_domain"]) {
      const response = await POST(request({ question: "Resumen", brand: "izzi", ...(domain === undefined ? {} : { domain }) }));
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).not.toHaveProperty("answer");
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE|acc1|Promociones/);
    }
    const accepted = await POST(request({ question: "Resumen", brand: "izzi", domain: "fixture_domain" }));
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).answer.context.domain).toEqual(snapshot.meta.domain);
  });

  it("validates domain input before reading data and preserves all-scope compatibility", async () => {
    for (const domain of [null, [], {}, 1, "", "ALL", "../first_domain", "x".repeat(65)]) {
      expect((await POST(request({ question: "Resumen", brand: "izzi", domain }))).status).toBe(400);
    }
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect((await POST(request({ question: "Resumen", brand: "izzi", domain: "all" }))).status).toBe(200);
  });

  it("bounds input, rejects malformed bodies and does not compute a snapshot", async () => {
    for (const body of [null, [], {}, { question: "", brand: "izzi" }, { question: "x".repeat(501), brand: "izzi" }, { question: 123, brand: "izzi" }, { question: "Resumen", brand: "unknown" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(new Request("http://localhost/api/nexus", { method: "POST", body: "invalid json" }))).status).toBe(400);
    expect((await POST(request({ question: "Resumen", brand: "izzi", extra: "x".repeat(5_000) }))).status).toBe(400);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("returns only an answer projection with private no-store caching", async () => {
    const response = await POST(request({ question: "Campaña 12345", brand: "izzi", history: [{ secret: "not used" }] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.answer.context.brand).toBe("izzi");
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|not used|foreign|sky-secret|999/);
  });

  it("does not expose underlying errors, codes, URLs or tokens", async () => {
    mocks.snapshot.mockRejectedValue(new Error("client_secret=PRIVATE signed=https://private.invalid"));
    const response = await POST(request({ question: "Resumen", brand: "izzi" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/PRIVATE|secret|private.invalid/);
  });

  it("caps repeated calls before additional snapshot computation", async () => {
    for (let index = 0; index < 12; index++) expect((await POST(request({ question: "Resumen", brand: "izzi" }))).status).toBe(200);
    const response = await POST(request({ question: "Resumen", brand: "izzi" }));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mocks.snapshot).toHaveBeenCalledTimes(12);
  });

  it("accepts exactly 4096 streamed UTF-8 bytes including split multi-byte characters and rejects the next byte", async () => {
    const base = JSON.stringify({ question: "Campaña 12345", brand: "izzi", ignored: "😀á" });
    const bytes = new TextEncoder().encode(base + " ".repeat(4_096 - new TextEncoder().encode(base).length));
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset)); else controller.close(); },
    });
    const response = await POST(new Request("http://localhost/api/nexus", { method: "POST", body: stream, duplex: "half", headers: { "Content-Length": "1" } } as RequestInit));
    expect(response.status).toBe(200);
    const oversized = new Request("http://localhost/api/nexus", { method: "POST", body: new Uint8Array([...bytes, 32]), headers: { "Content-Length": "1" } });
    expect((await POST(oversized)).status).toBe(400);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed or truncated UTF-8 and stream failures without error details", async () => {
    const encoder = new TextEncoder();
    const invalid = new Uint8Array([...encoder.encode('{"question":"'), 0xc3, 0x28, ...encoder.encode('\",\"brand\":\"izzi\"}')]);
    const truncated = new Uint8Array([...encoder.encode('{"question":"Resumen","brand":"izzi"}'), 0xe2, 0x82]);
    for (const bytes of [invalid, truncated]) expect((await POST(new Request("http://localhost/api/nexus", { method: "POST", body: bytes }))).status).toBe(400);
    const failed = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("PRIVATE TOKEN")); } });
    const response = await POST(new Request("http://localhost/api/nexus", { method: "POST", body: failed, duplex: "half" } as RequestInit));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("cancels unconsumed streaming input after a decoder failure or size rejection", async () => {
    const invalidCanceled = vi.fn();
    const invalid = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([0xc3, 0x28])); }, cancel: invalidCanceled,
    });
    expect((await POST(new Request("http://localhost/api/nexus", { method: "POST", body: invalid, duplex: "half" } as RequestInit))).status).toBe(400);
    expect(invalidCanceled).toHaveBeenCalledOnce();
    const oversizedCanceled = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(4_097).fill(32)); }, cancel: oversizedCanceled,
    });
    expect((await POST(new Request("http://localhost/api/nexus", { method: "POST", body: oversized, duplex: "half" } as RequestInit))).status).toBe(400);
    expect(oversizedCanceled).toHaveBeenCalledOnce();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("counts question length consistently in UTF-16 and lets invalid input consume no rate budget", async () => {
    for (let index = 0; index < 13; index++) expect((await POST(request({ question: "😀".repeat(251), brand: "izzi" }))).status).toBe(400);
    expect((await POST(request({ question: "😀".repeat(250), brand: "izzi" }))).status).toBe(200);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it("authorizes only the selected permitted brand and projects it even when session brands include both", async () => {
    mocks.session.mockResolvedValue({ authenticated: true, role: "auditor", permissions: ["internal:view"], brands: ["izzi", "sky"], user: { id: `nexus-dual-${user}` } });
    const response = await POST(request({ question: "Resumen", brand: "izzi" }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/FOREIGN|sky-secret|PRIVATE/);
    mocks.session.mockResolvedValue({ authenticated: true, role: "admin", permissions: [], brands: [], user: { id: `nexus-admin-${user}` } });
    expect((await POST(request({ question: "Resumen", brand: "izzi" }))).status).toBe(403);
  });
});
