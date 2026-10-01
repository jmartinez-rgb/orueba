import { readFileSync } from "node:fs";
import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config/env.js";
import { prepareEnv } from "./config/load-env.js";

prepareEnv();

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

async function main() {
  let config;
  try {
    config = loadConfig(process.env, pkg.version);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const app = await buildApp(config);
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "cerrando servidor");
    const timer = setTimeout(() => process.exit(1), 10_000).unref();
    await app.close();
    clearTimeout(timer);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  await app.listen({ host: config.host, port: config.port });
}

void main();
