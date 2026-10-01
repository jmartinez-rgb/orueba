import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { askHidden } from "../src/utils/cli-secret.js";

function terminal(raw = false) {
  const stream = new PassThrough();
  Object.defineProperty(stream, "isTTY", { value: true });
  Object.defineProperty(stream, "isRaw", { value: raw, writable: true });
  const input = stream as unknown as NodeJS.ReadStream;
  input.setRawMode = vi.fn((value) => {
    input.isRaw = value;
    return input;
  });
  const out = new PassThrough();
  let printed = "";
  out.on("data", (chunk) => {
    printed += String(chunk);
  });
  return { input, out: out as unknown as NodeJS.WriteStream, printed: () => printed };
}
describe("entrada oculta compartida", () => {
  it("nunca imprime el secreto y restaura el modo anterior", async () => {
    const t = terminal(),
      read = askHidden("Token: ", t.input, t.out);
    t.input.emit("data", "synthetic-private\r");
    expect(await read).toBe("synthetic-private");
    expect(t.printed()).toBe("Token: \n");
    expect(t.input.isRaw).toBe(false);
    expect(t.input.listenerCount("data")).toBe(0);
  });
  it("Ctrl-C cancela sin imprimir el valor y preserva un modo crudo preexistente", async () => {
    const t = terminal(true),
      read = askHidden("Token: ", t.input, t.out);
    t.input.emit("data", "synthetic-private\u0003");
    await expect(read).rejects.toThrow("Cancelado");
    expect(t.input.isRaw).toBe(true);
    expect(t.printed()).not.toContain("synthetic-private");
  });
  it("sin terminal no intenta leer ni imprimir un prompt", async () => {
    const stream = new PassThrough(),
      out = new PassThrough();
    expect(
      await askHidden("Token: ", stream as unknown as NodeJS.ReadStream, out as unknown as NodeJS.WriteStream),
    ).toBe("");
  });
  it("EOF limpia listeners y modo crudo", async () => {
    const t = terminal(),
      read = askHidden("Token: ", t.input, t.out);
    t.input.emit("end");
    await expect(read).rejects.toThrow("cancelada");
    expect(t.input.isRaw).toBe(false);
    expect(t.input.listenerCount("data")).toBe(0);
  });
  it("un pegado cuyo marcador llega en varios fragmentos conserva exactamente el token", async () => {
    const t = terminal(),
      read = askHidden("Token: ", t.input, t.out);
    for (const chunk of ["\u001b[20", "0~synthetic-private", "\u001b[201", "~\r"]) t.input.emit("data", chunk);
    expect(await read).toBe("synthetic-private");
    expect(t.printed()).not.toContain("synthetic-private");
  });
});
