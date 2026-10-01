import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MicrosoftProvider } from "../src/providers/microsoft/index.js";
import { SpotifyProvider } from "../src/providers/spotify/index.js";
import { applyTokenStore, readTokenStore, saveRotatedToken } from "../src/config/token-store.js";
import { prepareEnv } from "../src/config/load-env.js";
import { MICROSOFT_ENV, microsoftSimulator } from "./microsoft-simulator.js";
import { SpotifySimulator } from "./spotify-simulator.js";

// Auditoría: Microsoft rota el refresh token en cada renovación (Spotify a veces). Si el nuevo no se
// conserva, al reiniciar se usa el original, que vence aunque la integración se use a diario.
const dir = () => mkdtempSync(join(tmpdir(), "uaa-tokens-"));

describe("auditoría tokens: rotación", () => {
  it("Microsoft avisa del refresh token rotado para poder conservarlo", async () => {
    const rotated: string[] = [];
    const sim = microsoftSimulator();
    const provider = new MicrosoftProvider(MICROSOFT_ENV, {
      fetch: sim.request,
      retry: { sleep: async () => undefined, random: () => 0 },
      onRefreshTokenRotated: (t) => rotated.push(t),
    });
    await provider.status();
    expect(rotated).toEqual(["fake-rotated-refresh"]);
  });

  it("Spotify avisa del refresh token rotado", async () => {
    const rotated: string[] = [];
    const sim = new SpotifySimulator();
    const provider = new SpotifyProvider(sim.env, {
      fetch: sim.fetch,
      retry: { sleep: async () => undefined },
      onRefreshTokenRotated: (t) => rotated.push(t),
    });
    await provider.status();
    expect(rotated).toEqual(["synthetic-rotated-refresh"]);
  });
});

describe("auditoría tokens: almacén privado", () => {
  it("guarda con permisos 0600 sin tocar las demás líneas y gana al arrancar", async () => {
    const file = join(dir(), "tokens.env");
    writeFileSync(file, "# comentario\nOTRA=1\n");
    await saveRotatedToken(file, "MICROSOFT_ADS_REFRESH_TOKEN", "nuevo-refresh");
    await saveRotatedToken(file, "SPOTIFY_ADS_REFRESH_TOKEN", "spotify-nuevo");
    await saveRotatedToken(file, "MICROSOFT_ADS_REFRESH_TOKEN", "mas-nuevo");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("# comentario");
    expect(content).toContain("OTRA=1");
    expect(content.match(/MICROSOFT_ADS_REFRESH_TOKEN=/g)).toHaveLength(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readTokenStore(file)).toEqual({
      MICROSOFT_ADS_REFRESH_TOKEN: "mas-nuevo",
      SPOTIFY_ADS_REFRESH_TOKEN: "spotify-nuevo",
    });
    const env: NodeJS.ProcessEnv = { MICROSOFT_ADS_REFRESH_TOKEN: "viejo-del-panel" };
    expect(applyTokenStore(env, file)).toContain("MICROSOFT_ADS_REFRESH_TOKEN");
    expect(env.MICROSOFT_ADS_REFRESH_TOKEN).toBe("mas-nuevo");
    // Solo se aceptan tokens rotativos conocidos: el almacén no puede inyectar otras variables.
    writeFileSync(file, 'API_KEYS="inyectada"\n', { mode: 0o600 });
    expect(readTokenStore(file)).toEqual({});
  });

  it("escrituras simultáneas no se pierden ni dejan el archivo a medias", async () => {
    const file = join(dir(), "tokens.env");
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => saveRotatedToken(file, "MICROSOFT_ADS_REFRESH_TOKEN", `token-${i}`)),
    );
    expect(readTokenStore(file).MICROSOFT_ADS_REFRESH_TOKEN).toBe("token-9");
  });
});

describe("auditoría tokens: precedencia de .env", () => {
  it("una variable vacía del entorno no oculta el valor de .env; una con valor sí manda", () => {
    const env: NodeJS.ProcessEnv = { MICROSOFT_ADS_REFRESH_TOKEN: "", META_ACCESS_TOKEN: "del-panel" };
    prepareEnv(env, { MICROSOFT_ADS_REFRESH_TOKEN: "del-archivo", META_ACCESS_TOKEN: "del-archivo", NUEVA: "x" });
    expect(env).toMatchObject({
      MICROSOFT_ADS_REFRESH_TOKEN: "del-archivo",
      META_ACCESS_TOKEN: "del-panel",
      NUEVA: "x",
    });
  });
});
