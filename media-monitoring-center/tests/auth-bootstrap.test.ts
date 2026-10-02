import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import { verifyPassword } from "@/lib/auth/password";

it("crea accesos únicos privados, preserva el entorno y rechaza repetir o duplicar identidades", async () => {
  const root = resolve(import.meta.dirname, ".."), directory = await mkdtemp(join(tmpdir(), "private-nominal-"));
  const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const run = () => new Promise<{ code: number; stdout: string; stderr: string }>(done => execFile(process.execPath, ["--conditions=react-server", "--import", loader, join(root, "scripts/auth-bootstrap.ts"), "--roster", "roster.json", "--responders", "operativo", "--primary-admin", "admin"], { cwd: directory, timeout: 10000, encoding: "utf8", env: { NODE_ENV: "production", PATH: process.env.PATH, TSX_TSCONFIG_PATH: join(root, "tsconfig.json"), RECORDS_BACKEND: "file", RECORDS_DIR: ".data/records" } }, (error, stdout, stderr) => done({ code: typeof error?.code === "number" ? error.code : error ? 1 : 0, stdout, stderr })));
  try {
    const roster = [{ username: "admin", name: "Admin O'Connor $", email: "admin@example.test", role: "admin", brands: [] }, { username: "operativo", name: "Operativo", email: "ops@example.test", role: "manager", brands: ["izzi"] }];
    await writeFile(join(directory, "roster.json"), JSON.stringify(roster));
    await writeFile(join(directory, ".env.local"), "DATA_SOURCE=unified\nUNIFIED_ADS_API_KEY=synthetic-api-private-value\n");
    const result = await run(); expect(result.code).toBe(0);
    const file = join(directory, ".data/access/initial-credentials.json");
    const delivery = JSON.parse(await readFile(file, "utf8"));
    expect(delivery.accounts).toHaveLength(2);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, ".env.local"))).mode & 0o777).toBe(0o600);
    const content = await readFile(join(directory, ".env.local"), "utf8");
    expect(content).toContain("UNIFIED_ADS_API_KEY=synthetic-api-private-value");
    // Oficial Next parser: comprueba que apóstrofes y '$' no rompan el JSON ni se expandan.
    await writeFile(join(directory, ".env.test.local"), content);
    const loaded = loadEnvConfig(directory, false, { info() {}, error() {} }, true);
    const authUsers = JSON.parse(loaded.parsedEnv!.AUTH_USERS!);
    expect(authUsers[0].n).toBe(roster[0].name);
    expect(loaded.parsedEnv!.ALERT_RESPONDER_USER_IDS).toBe("operativo");
    expect(loaded.parsedEnv!.AUTH_PRIMARY_ADMIN_ID).toBe("admin");
    for (let i = 0; i < delivery.accounts.length; i++) {
      expect(await verifyPassword(delivery.accounts[i].password, authUsers[i].h)).toBe(true);
      expect(content).not.toContain(delivery.accounts[i].password);
      for (const privateValue of [delivery.accounts[i].password, authUsers[i].h, loaded.parsedEnv!.AUTH_SECRET!, "synthetic-api-private-value"]) expect(result.stdout + result.stderr).not.toContain(privateValue);
    }
    const second = await run(); expect(second.code).toBe(1);
    expect(second.stderr).toContain("AUTH_ALREADY_CONFIGURED");
    expect(await readFile(file, "utf8")).toBe(JSON.stringify(delivery, null, 2) + "\n");
    await writeFile(join(directory, ".env.local"), "DATA_SOURCE=unified\n");
    await writeFile(join(directory, "roster.json"), JSON.stringify([roster[0], { ...roster[1], email: roster[0].email }]));
    expect((await run()).stderr).toContain("INVALID_ROSTER");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
