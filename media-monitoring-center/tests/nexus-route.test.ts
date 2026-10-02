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
});
