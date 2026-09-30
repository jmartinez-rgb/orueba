import type { FastifyInstance } from "fastify";
import { buildApp, type AppDeps } from "../src/app.js";
import { testConfig, type AppConfig } from "../src/config/env.js";

export const KEY = "test-key-0123456789abcdefghij";

export async function makeApp(overrides: Partial<AppConfig> = {}, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = await buildApp(testConfig(overrides), deps);
  await app.ready();
  return app;
}
