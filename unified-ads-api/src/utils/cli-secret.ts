/** Terminal input never echoes the secret and always restores the previous raw mode. */
export async function askHidden(
  question: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string> {
  if (!input.isTTY) return "";
  const wasRaw = input.isRaw;
  output.write(question);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "",
      finished = false,
      escape = "";
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onEnd);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onEnd = () => finish(new Error("Entrada cancelada."));
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u001b" || escape) {
          escape += ch;
          const markers = ["\u001b[200~", "\u001b[201~"];
          if (markers.includes(escape)) {
            escape = "";
            continue;
          }
          if (markers.some((marker) => marker.startsWith(escape))) continue;
          finish(new Error("Secuencia de terminal no admitida."));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          finish();
          return;
        }
        if (ch === "\u0003") {
          finish(new Error("Cancelado."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
        if (value.length > 8192) {
          finish(new Error("Entrada demasiado larga."));
          return;
        }
      }
    };
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onEnd);
  });
}
