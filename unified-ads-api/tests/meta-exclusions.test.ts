import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { MetaClient } from "../src/providers/meta/client.js";
import { readMetaConfig } from "../src/providers/meta/config.js";
import {
  ADSET_FIELDS,
  ADSET_FIELDS_FULL_TARGETING,
  audiencePattern,
  auditExclusions,
  coverage,
  exclusionWorkbook,
  isCapiWhatsApp,
  parseAdSet,
} from "../src/providers/meta/exclusions.js";
import { buildXlsx, columnName, crc32, sheetNames, xmlText } from "../src/utils/xlsx.js";

const account = { id: "111", name: "MXN - izzi 1" };
const adSet = (id: string, campaign: string, status: string, excluded: string[], extra: Record<string, unknown> = {}) =>
  parseAdSet(
    {
      id,
      name: `Grupo ${id}`,
      effective_status: status,
      optimization_goal: "CONVERSATIONS",
      destination_type: "WHATSAPP",
      campaign: { id: `c-${campaign}`, name: campaign, effective_status: "ACTIVE" },
      targeting: {
        excluded_custom_audiences: excluded.map((name, i) => ({ id: `${id}-x${i}`, name })),
        custom_audiences: [{ id: "inc-1", name: "Visitantes web 30 días" }],
        targeting_automation: { advantage_audience: 1 },
      },
      ...extra,
    },
    account,
  );

/** Lee un .xlsx generado: valida firmas, CRC y devuelve el contenido de cada parte. */
function unzip(book: Buffer): Map<string, string> {
  const end = book.length - 22;
  expect(book.readUInt32LE(end)).toBe(0x06054b50);
  const count = book.readUInt16LE(end + 10);
  let at = book.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(book.readUInt32LE(at)).toBe(0x02014b50);
    const crc = book.readUInt32LE(at + 16);
    const size = book.readUInt32LE(at + 20);
    const nameLength = book.readUInt16LE(at + 28);
    const offset = book.readUInt32LE(at + 42);
    const name = book.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    expect(book.readUInt32LE(offset)).toBe(0x04034b50);
    const start = offset + 30 + book.readUInt16LE(offset + 26);
    const data = inflateRawSync(book.subarray(start, start + size));
    expect(crc32(data)).toBe(crc);
    files.set(name, data.toString("utf8"));
    at += 46 + nameLength;
  }
  return files;
}

describe("exclusiones de clientes activos en Meta", () => {
  it("lee audiencias excluidas, incluidas, campaña y Advantage+ desde la segmentación", () => {
    const row = adSet("1", "Venta CAPI WhatsApp Hogar", "ACTIVE", ["Clientes Activos izzi"]);
    expect(row).toMatchObject({
      accountId: "111",
      campaignId: "c-Venta CAPI WhatsApp Hogar",
      adSetStatus: "ACTIVE",
      excluded: [{ id: "1-x0", name: "Clientes Activos izzi" }],
      included: [{ id: "inc-1", name: "Visitantes web 30 días" }],
      advantageAudience: true,
    });
    const bare = parseAdSet(
      { id: "9", name: "Sin segmentación", effective_status: "PAUSED", campaign_id: "77" },
      account,
    );
    expect(bare).toMatchObject({ campaignId: "77", excluded: [], included: [], advantageAudience: null });
  });

  it("reconoce clientes activos sin importar acentos, mayúsculas o separadores", () => {
    const p = audiencePattern();
    for (const name of [
      "Clientes Activos",
      "BD_CLIENTES_ACTIVOS_sep",
      "Base clientes activós",
      "Activos - clientes izzi",
    ])
      expect(
        p.test(
          name
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase(),
        ),
      ).toBe(true);
    expect(p.test("visitantes web 30 dias")).toBe(false);
    expect(audiencePattern("Base Activa").test("base activa hogar")).toBe(true);
  });

  it("separa el universo CAPI WhatsApp del resto", () => {
    expect(isCapiWhatsApp("MXN | Venta CAPI WhatsApp | Hogar")).toBe(true);
    expect(isCapiWhatsApp("MXN | Mensajes WhatsApp | Hogar")).toBe(false);
  });

  it("clasifica grupos, campañas, cuentas y audiencias", () => {
    const rows = [
      adSet("1", "Venta CAPI WhatsApp", "ACTIVE", ["Clientes activos", "Empleados"]),
      adSet("2", "Venta CAPI WhatsApp", "ACTIVE", []),
      adSet("3", "Mensajes Hogar", "ACTIVE", ["Clientes Activos"]),
      adSet("4", "Mensajes Hogar", "PAUSED", []),
      adSet("5", "Alcance", "CAMPAIGN_PAUSED", ["Empleados"]),
    ];
    const audit = auditExclusions(rows, [
      { accountId: "111", accountName: "MXN - izzi 1", error: null },
      { accountId: "222", accountName: "222", error: "Meta requiere permiso ads_read." },
    ]);
    const byId = Object.fromEntries(audit.adSets.map((s) => [s.adSetId, s]));
    expect(byId["1"]).toMatchObject({
      universe: "CAPI WhatsApp",
      excludesActiveCustomers: true,
      activeCustomerAudiences: [{ name: "Clientes activos" }],
      otherExcluded: [{ name: "Empleados" }],
    });
    expect(byId["2"]!.excludesActiveCustomers).toBe(false);
    expect(byId["5"]!.excludesActiveCustomers).toBe(false);

    const camp = Object.fromEntries(audit.campaigns.map((c) => [c.campaignName, c]));
    expect(camp["Venta CAPI WhatsApp"]).toMatchObject({
      activeAdSets: 2,
      activeWithExclusion: 1,
      universe: "CAPI WhatsApp",
    });
    expect(camp["Mensajes Hogar"]).toMatchObject({
      activeAdSets: 1,
      activeWithExclusion: 1,
      adSets: 2,
      adSetsWithExclusion: 1,
    });
    expect(camp["Alcance"]).toMatchObject({ activeAdSets: 0, adSets: 1, adSetsWithExclusion: 0 });

    expect(audit.accounts).toEqual([
      expect.objectContaining({ accountId: "111", activeAdSets: 3, activeWithExclusion: 2, adSets: 5, campaigns: 3 }),
      expect.objectContaining({ accountId: "222", error: "Meta requiere permiso ads_read.", adSets: 0 }),
    ]);
    // Las audiencias de clientes activos van primero; cada ID se cuenta una vez por grupo.
    expect(audit.audiences[0]!.activeCustomers).toBe(true);
    expect(audit.audiences.filter((a) => a.name === "Empleados").reduce((n, a) => n + a.adSets, 0)).toBe(2);
  });

  it("la cobertura por campaña distingue todos, algunos, ninguno y sin grupos", () => {
    expect([coverage(2, 2), coverage(2, 1), coverage(2, 0), coverage(0, 0)]).toEqual([
      "Sí",
      "Parcial",
      "No",
      "Sin grupos",
    ]);
  });

  it("el libro trae resumen, campañas, grupos, audiencias y criterios con filas completas", () => {
    const audit = auditExclusions(
      [adSet("1", "Venta CAPI WhatsApp", "ACTIVE", ["Clientes activos"]), adSet("2", "Mensajes", "ACTIVE", [])],
      [
        { accountId: "111", accountName: "MXN - izzi 1", error: null },
        { accountId: "222", accountName: "222", error: "Sin permiso" },
      ],
    );
    const sheets = exclusionWorkbook(audit, {
      generatedAt: "1/10/2026",
      pattern: "client.*activ",
      statuses: ["ACTIVE"],
      apiVersion: "v26.0",
    });
    expect(sheets.map((s) => s.name)).toEqual([
      "Resumen por cuenta",
      "Campañas",
      "Grupos de anuncios",
      "Audiencias excluidas",
      "Criterios",
    ]);
    for (const s of sheets) for (const row of s.rows) expect(row.length).toBeLessThanOrEqual(s.columns.length);
    expect(sheets[0]!.rows[0]![6]).toBe(0.5);
    expect(sheets[0]!.rows[1]![9]).toMatchObject({ value: "Sin lectura: Sin permiso", tone: "bad" });
    expect(sheets[4]!.rows.some((r) => r[0] === "Cuenta sin lectura 222")).toBe(true);
  });
});

describe("escritor xlsx", () => {
  it("nombra columnas como Excel", () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
  });

  it("limpia nombres de hoja inválidos, largos o repetidos", () => {
    expect(sheetNames(["Campañas/2026", "Campañas/2026", "x".repeat(40), ""])).toEqual([
      "Campañas 2026",
      "Campañas 2026 2",
      "x".repeat(31),
      "Hoja 4",
    ]);
  });

  it("escapa XML y quita caracteres de control", () => {
    expect(xmlText('A & B <c> "d"\u0001')).toBe("A &amp; B &lt;c&gt; &quot;d&quot;");
  });

  it("produce un ZIP válido con las partes de un libro y celdas con estilo", () => {
    const book = buildXlsx([
      {
        name: "Resumen",
        columns: [{ header: "Cuenta" }, { header: "Avance", pct: true }, { header: "Excluye" }],
        rows: [
          ["izzi & Sky <1>", 0.25, { value: "Sí", tone: "good" }],
          [null, Number.NaN, { value: "No", tone: "bad" }],
        ],
      },
      { name: "Detalle", columns: [{ header: "Uno" }], rows: [] },
    ]);
    const files = unzip(book);
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">izzi &amp; Sky &lt;1&gt;</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2" s="2"><v>0.25</v></c>');
    expect(sheet).toContain('<c r="C2" s="3" t="inlineStr">');
    expect(sheet).not.toContain("NaN");
    expect(sheet).toContain('<autoFilter ref="A1:C3"/>');
    expect(files.get("xl/workbook.xml")).toContain(
      '<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'Resumen\'!$A$1:$C$3</definedName>',
    );
    expect(
      buildXlsx([{ name: "A", columns: [], rows: [] }]).equals(buildXlsx([{ name: "A", columns: [], rows: [] }])),
    ).toBe(true);
  });
});

describe("lectura de grupos de anuncios en Meta", () => {
  it("permite el listado de grupos con tamaño de página propio y sin seguir paging.next", async () => {
    const { config } = readMetaConfig({ META_ACCESS_TOKEN: "token-de-prueba" });
    const calls: URL[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      const page = url.searchParams.get("after")
        ? { data: [{ id: "2" }] }
        : {
            data: [{ id: "1" }],
            paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/next?access_token=x" },
          };
      return new Response(JSON.stringify(page), { status: 200 });
    });
    const client = new MetaClient(config!, fetcher as unknown as typeof fetch);
    const rows = await client.list(
      "act_111/adsets",
      { fields: ADSET_FIELDS_FULL_TARGETING, effective_status: '["ACTIVE"]' },
      AbortSignal.timeout(5000),
      25,
    );
    expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
    expect(calls.map((u) => u.pathname)).toEqual(["/v26.0/act_111/adsets", "/v26.0/act_111/adsets"]);
    expect(calls.every((u) => u.searchParams.get("limit") === "25" && !u.searchParams.has("access_token"))).toBe(true);
    expect(calls[1]!.searchParams.get("after")).toBe("c1");
    expect(ADSET_FIELDS).toContain("targeting{custom_audiences,excluded_custom_audiences,targeting_automation}");
    expect(ADSET_FIELDS_FULL_TARGETING).toMatch(/,targeting$/);
  });
});
