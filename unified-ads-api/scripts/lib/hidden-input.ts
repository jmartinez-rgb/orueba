/** Pide un valor en la terminal sin mostrarlo (modo crudo). Sin terminal interactiva devuelve "". */
export async function askHidden(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) return "";
  process.stdout.write(question);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      // Quita las marcas de pegado entre corchetes que algunas terminales agregan.
      for (const ch of chunk.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "")) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          finish();
          reject(new Error("Cancelado."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    input.on("data", onData);
  });
}
