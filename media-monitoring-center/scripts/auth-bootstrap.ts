import { loadEnvConfig } from "@next/env";
import { lstat, readFile, open, rename, rm, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { hashPassword } from "../src/lib/auth/password";
import { generatePassword, listManagedUsers, passwordProblem, USERNAME_RE } from "../src/lib/auth/users";
import { ROLES, PERMISSIONS, type Permission, type Role } from "../src/lib/auth/roles";

const rosterSchema = z.array(z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME_RE),
  name: z.string().trim().min(3).max(60).refine(value => !/[\u0000-\u001f<>]/.test(value)),
  email: z.email().max(254).transform(value => value.toLowerCase()).nullable().default(null),
  role: z.enum(ROLES as [Role, ...Role[]]),
  permissions: z.array(z.enum(PERMISSIONS as [Permission, ...Permission[]])).max(PERMISSIONS.length).nullable().default(null),
  brands: z.array(z.enum(["izzi", "sky"])).max(2).default([]),
}).strict()).min(1).max(100).refine(users => users.some(u => u.role === "admin" && (u.permissions === null || u.permissions.includes("users:manage"))) && new Set(users.map(u => u.username)).size === users.length && new Set(users.filter(u => u.email).map(u => u.email)).size === users.filter(u => u.email).length);

async function atomic(file: string, value: string) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(value, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}

async function bootstrap() {
  const args = process.argv.slice(2);
  if (args.includes("--ayuda") || args.includes("--help")) {
    process.stdout.write("npm run auth:bootstrap -- --roster .data/access/roster.json [--responders usuario1,usuario2] [--primary-admin usuario]\nO un administrador: --user usuario --name 'Nombre Apellido' --brand izzi|sky|ambas, con AUTH_INITIAL_ADMIN_PASSWORD privada.\nSolo acceso inicial: nunca sobrescribe cuentas. Con --roster genera contraseñas, guardadas únicamente en .data/access/initial-credentials.json (0600), y hashes en .env.local atómico (0600). No imprime credenciales, crea contraseña universal ni publica.\n"); return;
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--roster", "--user", "--name", "--brand", "--responders", "--primary-admin"].includes(args[i]) || !args[i + 1] || values[args[i]]) throw new Error("INVALID_OPTIONS");
    values[args[i]] = args[i + 1];
  }
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  process.env.LOG_LEVEL = "error";
  if ((process.env.AUTH_USERS ?? "").trim() || (process.env.AUTH_UNIVERSAL_PASSWORD_HASH ?? "").trim() || (await listManagedUsers(true)).length) throw new Error("AUTH_ALREADY_CONFIGURED");
  const existingSecret = (process.env.AUTH_SECRET ?? "").trim();
  if (existingSecret && existingSecret.length < 32) throw new Error("INVALID_AUTH_SECRET");
  let roster: z.infer<typeof rosterSchema>;
  if (values["--roster"]) {
    if (Object.keys(values).some(key => !["--roster", "--responders", "--primary-admin"].includes(key))) throw new Error("INVALID_OPTIONS");
    const parsed = rosterSchema.safeParse(JSON.parse(await readFile(values["--roster"], "utf8")));
    if (!parsed.success) throw new Error("INVALID_ROSTER");
    roster = parsed.data;
  } else {
    const brand = values["--brand"];
    if (!["izzi", "sky", "ambas"].includes(brand)) throw new Error("INVALID_IDENTITY");
    const parsed = rosterSchema.safeParse([{ username: values["--user"], name: values["--name"], role: "admin", brands: brand === "ambas" ? [] : [brand] }]);
    if (!parsed.success) throw new Error("INVALID_IDENTITY");
    roster = parsed.data;
    if (!process.env.AUTH_INITIAL_ADMIN_PASSWORD || passwordProblem(process.env.AUTH_INITIAL_ADMIN_PASSWORD)) throw new Error("INITIAL_PASSWORD_MISSING_OR_INVALID");
  }
  const responders = values["--responders"]?.split(",").map(id => id.trim().toLowerCase());
  if (responders && (responders.some(id => !roster.some(user => user.username === id && user.role !== "client")) || new Set(responders).size !== responders.length)) throw new Error("INVALID_RESPONDERS");
  const primaryAdmin = values["--primary-admin"];
  if (primaryAdmin && !roster.some(user => user.username === primaryAdmin && user.role === "admin")) throw new Error("INVALID_PRIMARY_ADMIN");
  const credentials = roster.map(user => ({ ...user, password: values["--roster"] ? generatePassword() : process.env.AUTH_INITIAL_ADMIN_PASSWORD! }));
  const users = await Promise.all(credentials.map(async user => ({ u: user.username, n: user.name, email: user.email, r: user.role, brands: user.brands, permissions: user.permissions, h: await hashPassword(user.password) })));
  const file = ".env.local", delivery = ".data/access/initial-credentials.json";
  let content = "";
  try { if (!(await lstat(file)).isFile()) throw new Error("ENV_UNAVAILABLE"); content = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { await lstat(delivery); throw new Error("PRIVATE_DELIVERY_EXISTS"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  content = content.replace(/^AUTH_INITIAL_ADMIN_PASSWORD=.*(?:\r?\n|$)/gm, "");
  const encoded = JSON.stringify(users).replaceAll("'", "\\u0027").replaceAll("$", "\\u0024");
  for (const [key, value] of Object.entries({ AUTH_MODE: "password", AUTH_SECRET: existingSecret || randomBytes(48).toString("base64url"), AUTH_USERS: `'${encoded}'`, AUTH_SESSION_HOURS: "12", ...(responders ? { ALERT_RESPONDER_USER_IDS: responders.join(",") } : {}), ...(primaryAdmin ? { AUTH_PRIMARY_ADMIN_ID: primaryAdmin } : {}) })) {
    const re = new RegExp(`^${key}=.*$`, "m"), line = `${key}=${value}`;
    content = re.test(content) ? content.replace(re, () => line) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  await atomic(delivery, JSON.stringify({ createdAt: new Date().toISOString(), accounts: credentials }, null, 2) + "\n");
  try { await atomic(file, content); } catch (error) { await rm(delivery, { force: true }); throw error; }
  delete process.env.AUTH_INITIAL_ADMIN_PASSWORD;
  process.stdout.write(`Acceso nominal inicial guardado: ${users.length} cuentas. Contraseñas en archivo privado .data/access/initial-credentials.json; hashes en .env.local. Reinicia el servidor. No se imprimieron credenciales ni se publicó el entorno.\n`);
}

void bootstrap().catch(error => {
  const allowed = ["INVALID_OPTIONS", "INVALID_IDENTITY", "INVALID_ROSTER", "INVALID_RESPONDERS", "INVALID_PRIMARY_ADMIN", "AUTH_ALREADY_CONFIGURED", "INITIAL_PASSWORD_MISSING_OR_INVALID", "INVALID_AUTH_SECRET", "ENV_UNAVAILABLE", "PRIVATE_DELIVERY_EXISTS"];
  const code = error instanceof Error && allowed.includes(error.message) ? error.message : "BOOTSTRAP_FAILED";
  process.stderr.write(`No se pudo crear el acceso inicial: ${code}. Los valores privados permanecen ocultos.\n`); process.exitCode = 1;
});
