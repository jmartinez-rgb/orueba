import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Radix Select fills the trigger text only after its items mount, and a value alone ("ALERT") gives
// no context: every trigger needs its own accessible name (aria-label or an id tied to a Label).
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : []; });
}

describe("desplegables con nombre accesible", () => {
  it("cada SelectTrigger tiene aria-label o un id asociado a un Label con htmlFor", () => {
    const missing: string[] = [];
    for (const file of [...files("src/components"), ...files("src/app")]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<SelectTrigger\b([^>]*)>/g)) {
        const attrs = match[1];
        if (/aria-label(?:ledby)?=/.test(attrs)) continue;
        const id = /\bid=(\{[^}]+\}|"[^"]+")/.exec(attrs)?.[1];
        if (id && source.includes(`htmlFor=${id}`)) continue;
        missing.push(`${file}:${source.slice(0, match.index).split("\n").length}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
