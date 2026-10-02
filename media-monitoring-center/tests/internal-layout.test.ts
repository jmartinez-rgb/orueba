import { beforeEach, expect, it, vi } from "vitest";
import MonitoringLayout from "@/app/(app)/layout";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/session", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/auth/session")>(), requireSession: mocks.session }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: () => null }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
beforeEach(() => vi.resetAllMocks());

it("rechaza páginas internas para clientes aunque una sesión incompatible incluya internal:view", async () => {
  mocks.session.mockResolvedValue({ authenticated: true, role: "client", permissions: ["client:view", "internal:view"] });
  await expect(MonitoringLayout({ children: "datos internos" })).rejects.toThrow("redirect:/cliente");
});

it("comprueba el permiso interno además del rol antes de devolver contenido", async () => {
  mocks.session.mockResolvedValue({ authenticated: true, role: "manager", permissions: ["client:view"] });
  await expect(MonitoringLayout({ children: "datos internos" })).rejects.toThrow("redirect:/cliente");
  mocks.session.mockResolvedValue({ authenticated: true, role: "manager", permissions: ["internal:view", "client:view"] });
  const layout = await MonitoringLayout({ children: "datos internos" });
  expect(layout.props.children).toBe("datos internos");
});
