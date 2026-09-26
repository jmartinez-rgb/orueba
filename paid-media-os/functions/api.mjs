import { createRequire } from 'module'; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};

// server/env.ts
function v(k, d = "") {
  return (process.env[k] ?? d).trim();
}
function configProblems() {
  const out = [];
  if (!env.sessionSecret || env.sessionSecret.length < 32) out.push("SESSION_SECRET falta o tiene menos de 32 caracteres.");
  const google = !!(env.googleClientId && env.googleClientSecret);
  if (!env.devLogin && !google && !env.accessCode) out.push("No hay forma de iniciar sesi\xF3n: define ACCESS_CODE (c\xF3digo de acceso) o GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.");
  if (env.accessCode && env.accessCode.length < 10) out.push("ACCESS_CODE debe tener al menos 10 caracteres.");
  if (env.metaMode !== "mock" && !env.metaToken) out.push("Falta META_ACCESS_TOKEN (o conecta un token desde Conexi\xF3n con Meta).");
  if (!/^v\d+\.\d+$/.test(env.metaVersion)) out.push("META_API_VERSION debe tener el formato v26.0.");
  return out;
}
var env;
var init_env = __esm({
  "server/env.ts"() {
    "use strict";
    env = {
      get appUrl() {
        return v("APP_URL", v("URL", "http://localhost:5173")).replace(/\/$/, "");
      },
      get sessionSecret() {
        return v("SESSION_SECRET");
      },
      get googleClientId() {
        return v("GOOGLE_CLIENT_ID");
      },
      get googleClientSecret() {
        return v("GOOGLE_CLIENT_SECRET");
      },
      get allowedDomains() {
        return v("ALLOWED_DOMAINS", "abcw.global,abcw.mx").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      },
      get requireHd() {
        return v("GOOGLE_REQUIRE_HD", "true") !== "false";
      },
      get adminEmails() {
        return v("ADMIN_EMAILS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      },
      get metaVersion() {
        return v("META_API_VERSION", "v26.0");
      },
      get metaToken() {
        return v("META_ACCESS_TOKEN");
      },
      get metaAppId() {
        return v("META_APP_ID");
      },
      get metaAppSecret() {
        return v("META_APP_SECRET");
      },
      get metaLoginConfigId() {
        return v("META_LOGIN_CONFIG_ID");
      },
      /** IDs de WABA que se revisan aunque Meta no las liste en los portafolios del token (separados por coma). */
      get metaWabaIds() {
        return v("META_WABA_IDS").split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^\d{6,}$/.test(s));
      },
      get metaMode() {
        return v("META_MODE", "live");
      },
      /** Código de acceso compartido (alternativa a Google OAuth). Mínimo 10 caracteres. */
      get accessCode() {
        return v("ACCESS_CODE");
      },
      get motorUrl() {
        return v("MOTOR_URL");
      },
      get motorSecret() {
        return v("MOTOR_SHARED_SECRET");
      },
      /** true solo fuera de Netlify (desarrollo local o pruebas). */
      get isLocal() {
        return !process.env.NETLIFY && process.env.NODE_ENV !== "production";
      },
      get devLogin() {
        return this.isLocal && v("DEV_LOGIN") === "1";
      },
      get isProduction() {
        return v("CONTEXT") === "production";
      }
    };
  }
});

/* Versión de la Graph API: la vigente (objetivo) y la más antigua que Meta todavía acepta. */
var API_TARGET = 26;
var API_MIN = 24;

// server/lib/crypto.ts
async function keyFor(purpose, usage) {
  const secret = env.sessionSecret;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET no est\xE1 configurado (m\xEDnimo 32 caracteres).");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("pmos"), info: enc.encode(purpose) },
    base,
    usage === "hmac" ? { name: "HMAC", hash: "SHA-256", length: 256 } : { name: "AES-GCM", length: 256 },
    false,
    usage === "hmac" ? ["sign", "verify"] : ["encrypt", "decrypt"]
  );
}
async function sign(payload, purpose = "session") {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig2 = await crypto.subtle.sign("HMAC", await keyFor(purpose, "hmac"), enc.encode(body));
  return body + "." + b64u(sig2);
}
async function verify(token, purpose = "session") {
  const [body, sig2] = String(token || "").split(".");
  if (!body || !sig2) return null;
  const ok2 = await crypto.subtle.verify("HMAC", await keyFor(purpose, "hmac"), fromB64u(sig2), enc.encode(body));
  if (!ok2) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor("tokens", "aes"), enc.encode(text));
  return b64u(iv) + "." + b64u(ct);
}
async function decrypt(blob) {
  const [iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(iv) }, await keyFor("tokens", "aes"), fromB64u(ct));
  return new TextDecoder().decode(pt);
}
function randomId(bytes = 16) {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function sha256Hex(s) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", enc.encode(s))).toString("hex");
}
async function hmacHex(key2, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key2), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", k, enc.encode(msg))).toString("hex");
}
var enc, b64u, fromB64u;
var init_crypto = __esm({
  "server/lib/crypto.ts"() {
    "use strict";
    init_env();
    enc = new TextEncoder();
    b64u = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
    fromB64u = (s) => new Uint8Array(Buffer.from(s, "base64url"));
  }
});

// node_modules/@netlify/runtime-utils/dist/main.js
var getString, base64Decode, base64Encode, getEnvironment;
var init_main = __esm({
  "node_modules/@netlify/runtime-utils/dist/main.js"() {
    getString = (input) => typeof input === "string" ? input : JSON.stringify(input);
    base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input);
    base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input));
    getEnvironment = () => {
      const { Deno, Netlify, process: process2 } = globalThis;
      return Netlify?.env ?? Deno?.env ?? {
        delete: (key2) => delete process2?.env[key2],
        get: (key2) => process2?.env[key2],
        has: (key2) => Boolean(process2?.env[key2]),
        set: (key2, value) => {
          if (process2?.env) {
            process2.env[key2] = value;
          }
        },
        toObject: () => process2?.env ?? {}
      };
    };
  }
});

// node_modules/@netlify/otel/dist/main.js
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  const func = typeof contextOrFn === "function" ? contextOrFn : typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!func) {
    throw new Error("function to execute with active span is missing");
  }
  if (!tracer) {
    return func();
  }
  return tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func);
}
var GET_TRACER, getTracer;
var init_main2 = __esm({
  "node_modules/@netlify/otel/dist/main.js"() {
    GET_TRACER = "__netlify__getTracer";
    getTracer = (name, version) => {
      return globalThis[GET_TRACER]?.(name, version);
    };
  }
});

// node_modules/@netlify/blobs/dist/chunk-6TDSNTDP.js
function withSpan(span, name, fn) {
  if (span) return fn(span);
  return withActiveSpan(getTracer(), name, (span2) => {
    return fn(span2);
  });
}
var getEnvironmentContext, setEnvironmentContext, MissingBlobsEnvironmentError, BASE64_PREFIX, METADATA_HEADER_INTERNAL, METADATA_HEADER_EXTERNAL, METADATA_MAX_SIZE, encodeMetadata, decodeMetadata, getMetadataFromResponse, NF_ERROR, NF_REQUEST_ID, DEPLOY_STORE_PREFIX, SITE_STORE_PREFIX, isDeniedWrite, blobsErrorMessage, BlobsInternalError, createBlobsInternalError, collectIterator, BlobsConsistencyError, REGION_AUTO, regions, isValidRegion, InvalidBlobsRegionError, DEFAULT_RETRY_DELAY, MIN_RETRY_DELAY, MAX_RETRY, RATE_LIMIT_HEADER, fetchAndRetry, getDelay, sleep, SIGNED_URL_ACCEPT_HEADER, Client, getClientOptions;
var init_chunk_6TDSNTDP = __esm({
  "node_modules/@netlify/blobs/dist/chunk-6TDSNTDP.js"() {
    init_main();
    init_main();
    init_main2();
    init_main();
    getEnvironmentContext = () => {
      const context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
      if (typeof context !== "string" || !context) {
        return {};
      }
      const data = base64Decode(context);
      try {
        return JSON.parse(data);
      } catch {
      }
      return {};
    };
    setEnvironmentContext = (context) => {
      const encodedContext = base64Encode(JSON.stringify(context));
      getEnvironment().set("NETLIFY_BLOBS_CONTEXT", encodedContext);
    };
    MissingBlobsEnvironmentError = class extends Error {
      constructor(requiredProperties) {
        super(
          `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
            ", "
          )}`
        );
        this.name = "MissingBlobsEnvironmentError";
      }
    };
    BASE64_PREFIX = "b64;";
    METADATA_HEADER_INTERNAL = "x-amz-meta-user";
    METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
    METADATA_MAX_SIZE = 2 * 1024;
    encodeMetadata = (metadata) => {
      if (!metadata) {
        return null;
      }
      const encodedObject = base64Encode(JSON.stringify(metadata));
      const payload = `b64;${encodedObject}`;
      if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE) {
        throw new Error("Metadata object exceeds the maximum size");
      }
      return payload;
    };
    decodeMetadata = (header) => {
      if (!header?.startsWith(BASE64_PREFIX)) {
        return {};
      }
      const encodedData = header.slice(BASE64_PREFIX.length);
      const decodedData = base64Decode(encodedData);
      const metadata = JSON.parse(decodedData);
      return metadata;
    };
    getMetadataFromResponse = (response) => {
      if (!response.headers) {
        return {};
      }
      const value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
      try {
        return decodeMetadata(value);
      } catch {
        throw new Error(
          "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
        );
      }
    };
    NF_ERROR = "x-nf-error";
    NF_REQUEST_ID = "x-nf-request-id";
    DEPLOY_STORE_PREFIX = "deploy:";
    SITE_STORE_PREFIX = "site:";
    isDeniedWrite = (res, { method, storeName }) => (res.status === 401 || res.status === 403) && (method === "put" || method === "delete") && storeName !== void 0 && !storeName.startsWith(DEPLOY_STORE_PREFIX);
    blobsErrorMessage = (res, context, responseBody) => {
      let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
      if (res.headers.has(NF_REQUEST_ID)) {
        details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`;
      }
      if (isDeniedWrite(res, context)) {
        const storeName = context.storeName?.startsWith(SITE_STORE_PREFIX) ? context.storeName.slice(SITE_STORE_PREFIX.length) : context.storeName;
        return `Netlify Blobs could not write to store '${storeName}' (${details}). Builds and build plugins can only write to deploy-specific stores: use 'getDeployStore' instead of 'getStore', or pass a 'token' with write access to the store. If this code is not running in a build, check that the token and site ID are valid. See https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores`;
      }
      let message2 = `Netlify Blobs has generated an internal error (${details})`;
      if (!res.headers.get(NF_ERROR) && responseBody) {
        message2 += `: ${responseBody}`;
      }
      return message2;
    };
    BlobsInternalError = class extends Error {
      constructor(res, context = {}, responseBody) {
        super(blobsErrorMessage(res, context, responseBody));
        this.name = "BlobsInternalError";
        this.status = res.status;
        this.responseBody = responseBody;
      }
    };
    createBlobsInternalError = async (res, context = {}) => {
      const responseBody = await res.clone().text().catch(() => void 0);
      return new BlobsInternalError(res, context, responseBody);
    };
    collectIterator = async (iterator) => {
      const result = [];
      for await (const item of iterator) {
        result.push(item);
      }
      return result;
    };
    BlobsConsistencyError = class extends Error {
      constructor() {
        super(
          `Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property`
        );
        this.name = "BlobsConsistencyError";
      }
    };
    REGION_AUTO = "auto";
    regions = {
      "us-east-1": true,
      "us-east-2": true,
      "eu-central-1": true,
      "ap-southeast-1": true,
      "ap-southeast-2": true
    };
    isValidRegion = (input) => Object.keys(regions).includes(input);
    InvalidBlobsRegionError = class extends Error {
      constructor(region) {
        super(
          `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
        );
        this.name = "InvalidBlobsRegionError";
      }
    };
    DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3;
    MIN_RETRY_DELAY = 1e3;
    MAX_RETRY = 5;
    RATE_LIMIT_HEADER = "X-RateLimit-Reset";
    fetchAndRetry = async (fetch2, url, options, attemptsLeft = MAX_RETRY, getRetryUrl) => {
      try {
        const res = await fetch2(url, options);
        const isRetryable = res.status === 429 || res.status >= 500 || getRetryUrl !== void 0 && res.status === 403;
        if (attemptsLeft > 0 && isRetryable) {
          const delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
          await sleep(delay);
          const retryUrl = getRetryUrl ? await getRetryUrl() : url;
          return fetchAndRetry(fetch2, retryUrl, options, attemptsLeft - 1, getRetryUrl);
        }
        return res;
      } catch (error) {
        if (attemptsLeft === 0) {
          throw error;
        }
        const delay = getDelay();
        await sleep(delay);
        const retryUrl = getRetryUrl ? await getRetryUrl() : url;
        return fetchAndRetry(fetch2, retryUrl, options, attemptsLeft - 1, getRetryUrl);
      }
    };
    getDelay = (rateLimitReset) => {
      if (!rateLimitReset) {
        return DEFAULT_RETRY_DELAY;
      }
      return Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY);
    };
    sleep = (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
    SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url";
    Client = class {
      constructor({ apiURL, consistency, edgeURL, fetch: fetch2, region, siteID, token, uncachedEdgeURL }) {
        this.apiURL = apiURL;
        this.consistency = consistency ?? "eventual";
        this.edgeURL = edgeURL;
        this.fetch = fetch2 ?? globalThis.fetch;
        this.region = region;
        this.siteID = siteID;
        this.token = token;
        this.uncachedEdgeURL = uncachedEdgeURL;
        if (!this.fetch) {
          throw new Error(
            "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
          );
        }
      }
      async getFinalRequest({
        consistency: opConsistency,
        key: key2,
        metadata,
        method,
        parameters = {},
        storeName
      }) {
        const encodedMetadata = encodeMetadata(metadata);
        const consistency = opConsistency ?? this.consistency;
        let urlPath = `/${this.siteID}`;
        if (storeName) {
          urlPath += `/${storeName}`;
        }
        if (key2) {
          urlPath += `/${key2}`;
        }
        if (this.edgeURL) {
          if (consistency === "strong" && !this.uncachedEdgeURL) {
            throw new BlobsConsistencyError();
          }
          const headers = {
            authorization: `Bearer ${this.token}`
          };
          if (encodedMetadata) {
            headers[METADATA_HEADER_INTERNAL] = encodedMetadata;
          }
          if (this.region) {
            urlPath = `/region:${this.region}${urlPath}`;
          }
          const url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
          for (const key22 in parameters) {
            url2.searchParams.set(key22, parameters[key22]);
          }
          return {
            headers,
            url: url2.toString()
          };
        }
        const apiHeaders = { authorization: `Bearer ${this.token}` };
        const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
        for (const key22 in parameters) {
          url.searchParams.set(key22, parameters[key22]);
        }
        if (this.region) {
          url.searchParams.set("region", this.region);
        }
        if (storeName === void 0 || key2 === void 0) {
          return {
            headers: apiHeaders,
            url: url.toString()
          };
        }
        if (encodedMetadata) {
          apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata;
        }
        if (method === "head" || method === "delete") {
          return {
            headers: apiHeaders,
            url: url.toString()
          };
        }
        const res = await this.fetch(url.toString(), {
          headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
          method
        });
        if (res.status !== 200) {
          throw await createBlobsInternalError(res, { method, storeName });
        }
        const { url: signedURL } = await res.json();
        const userHeaders = encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0;
        return {
          headers: userHeaders,
          url: signedURL
        };
      }
      async makeRequest({
        body,
        conditions = {},
        consistency,
        headers: extraHeaders,
        key: key2,
        metadata,
        method,
        parameters,
        storeName
      }) {
        const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
          consistency,
          key: key2,
          metadata,
          method,
          parameters,
          storeName
        });
        const headers = {
          ...baseHeaders,
          ...extraHeaders
        };
        if (method === "put") {
          headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
        }
        if ("onlyIfMatch" in conditions && conditions.onlyIfMatch) {
          headers["if-match"] = conditions.onlyIfMatch;
        } else if ("onlyIfNew" in conditions && conditions.onlyIfNew) {
          headers["if-none-match"] = "*";
        }
        const options = {
          body,
          headers,
          method
        };
        if (body instanceof ReadableStream) {
          options.duplex = "half";
        }
        const usesSignedUrl = !this.edgeURL && key2 !== void 0 && storeName !== void 0 && method !== "head" && method !== "delete";
        let getRetryUrl;
        if (usesSignedUrl) {
          getRetryUrl = async () => {
            const finalRequest = await this.getFinalRequest({ consistency, key: key2, metadata, method, parameters, storeName });
            return finalRequest.url;
          };
        }
        return fetchAndRetry(this.fetch, url, options, void 0, getRetryUrl);
      }
    };
    getClientOptions = (options, contextOverride) => {
      const context = contextOverride ?? getEnvironmentContext();
      const siteID = context.siteID ?? options.siteID;
      const token = context.token ?? options.token;
      if (!siteID || !token) {
        throw new MissingBlobsEnvironmentError(["siteID", "token"]);
      }
      if (options.region !== void 0 && !isValidRegion(options.region)) {
        throw new InvalidBlobsRegionError(options.region);
      }
      const clientOptions = {
        apiURL: context.apiURL ?? options.apiURL,
        consistency: options.consistency,
        edgeURL: context.edgeURL ?? options.edgeURL,
        fetch: options.fetch,
        region: options.region,
        siteID,
        token,
        uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
      };
      return clientOptions;
    };
  }
});

// node_modules/@netlify/blobs/dist/main.js
var main_exports = {};
__export(main_exports, {
  connectLambda: () => connectLambda,
  getDeployStore: () => getDeployStore,
  getStore: () => getStore,
  listStores: () => listStores,
  setEnvironmentContext: () => setEnvironmentContext
});
function listStores(options = {}) {
  const context = getEnvironmentContext();
  const clientOptions = getClientOptions(options, context);
  const client = new Client(clientOptions);
  const iterator = getListIterator(client, SITE_STORE_PREFIX);
  if (options.paginate) {
    return iterator;
  }
  return collectIterator(iterator).then((results) => ({ stores: results.flatMap((page) => page.stores) }));
}
var connectLambda, LEGACY_STORE_INTERNAL_PREFIX, STATUS_OK, STATUS_PRE_CONDITION_FAILED, Store, getDeployStoreRegion, getDeployStore, getStore, formatListStoreResponse, getListIterator;
var init_main3 = __esm({
  "node_modules/@netlify/blobs/dist/main.js"() {
    init_chunk_6TDSNTDP();
    init_main();
    connectLambda = (event) => {
      const rawData = base64Decode(event.blobs);
      const data = JSON.parse(rawData);
      const environmentContext = {
        deployID: event.headers["x-nf-deploy-id"],
        edgeURL: data.url,
        siteID: event.headers["x-nf-site-id"],
        token: data.token
      };
      setEnvironmentContext(environmentContext);
    };
    LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/";
    STATUS_OK = 200;
    STATUS_PRE_CONDITION_FAILED = 412;
    Store = class _Store {
      constructor(options) {
        this.client = options.client;
        if ("deployID" in options) {
          _Store.validateDeployID(options.deployID);
          let name = DEPLOY_STORE_PREFIX + options.deployID;
          if (options.name) {
            name += `:${options.name}`;
          }
          this.name = name;
        } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
          const storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
          _Store.validateStoreName(storeName);
          this.name = storeName;
        } else {
          _Store.validateStoreName(options.name);
          this.name = SITE_STORE_PREFIX + options.name;
        }
      }
      async delete(key2) {
        const res = await this.client.makeRequest({ key: key2, method: "delete", storeName: this.name });
        if (![200, 204, 404].includes(res.status)) {
          throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
        }
      }
      async deleteAll() {
        let totalDeletedBlobs = 0;
        let hasMore = true;
        while (hasMore) {
          const res = await this.client.makeRequest({ method: "delete", storeName: this.name });
          if (res.status !== 200) {
            throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
          }
          const data = await res.json();
          if (typeof data.blobs_deleted !== "number") {
            throw new BlobsInternalError(res);
          }
          totalDeletedBlobs += data.blobs_deleted;
          hasMore = typeof data.has_more === "boolean" && data.has_more;
        }
        return {
          deletedBlobs: totalDeletedBlobs
        };
      }
      async get(key2, options) {
        return withSpan(options?.span, "blobs.get", async (span) => {
          const { consistency, type } = options ?? {};
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key2,
            "blobs.type": type,
            "blobs.method": "GET",
            "blobs.consistency": consistency
          });
          const res = await this.client.makeRequest({
            consistency,
            key: key2,
            method: "get",
            storeName: this.name
          });
          span?.setAttributes({
            "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
            "blobs.response.status": res.status
          });
          if (res.status === 404) {
            return null;
          }
          if (res.status !== 200) {
            throw new BlobsInternalError(res);
          }
          if (type === void 0 || type === "text") {
            return res.text();
          }
          if (type === "arrayBuffer") {
            return res.arrayBuffer();
          }
          if (type === "blob") {
            return res.blob();
          }
          if (type === "json") {
            return res.json();
          }
          if (type === "stream") {
            return res.body;
          }
          throw new BlobsInternalError(res);
        });
      }
      async getMetadata(key2, options = {}) {
        return withSpan(options?.span, "blobs.getMetadata", async (span) => {
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key2,
            "blobs.method": "HEAD",
            "blobs.consistency": options.consistency
          });
          const res = await this.client.makeRequest({
            consistency: options.consistency,
            key: key2,
            method: "head",
            storeName: this.name
          });
          span?.setAttributes({
            "blobs.response.status": res.status
          });
          if (res.status === 404) {
            return null;
          }
          if (res.status !== 200 && res.status !== 304) {
            throw new BlobsInternalError(res);
          }
          const etag = res?.headers.get("etag") ?? void 0;
          const metadata = getMetadataFromResponse(res);
          const result = {
            etag,
            metadata
          };
          return result;
        });
      }
      async getWithMetadata(key2, options) {
        return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
          const { consistency, etag: requestETag, type } = options ?? {};
          const headers = requestETag ? { "if-none-match": requestETag } : void 0;
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key2,
            "blobs.method": "GET",
            "blobs.consistency": options?.consistency,
            "blobs.type": type,
            "blobs.request.etag": requestETag
          });
          const res = await this.client.makeRequest({
            consistency,
            headers,
            key: key2,
            method: "get",
            storeName: this.name
          });
          const responseETag = res?.headers.get("etag") ?? void 0;
          span?.setAttributes({
            "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
            "blobs.response.etag": responseETag,
            "blobs.response.status": res.status
          });
          if (res.status === 404) {
            return null;
          }
          if (res.status !== 200 && res.status !== 304) {
            throw new BlobsInternalError(res);
          }
          const metadata = getMetadataFromResponse(res);
          const result = {
            etag: responseETag,
            metadata
          };
          if (res.status === 304 && requestETag) {
            return { data: null, ...result };
          }
          if (type === void 0 || type === "text") {
            return { data: await res.text(), ...result };
          }
          if (type === "arrayBuffer") {
            return { data: await res.arrayBuffer(), ...result };
          }
          if (type === "blob") {
            return { data: await res.blob(), ...result };
          }
          if (type === "json") {
            return { data: await res.json(), ...result };
          }
          if (type === "stream") {
            return { data: res.body, ...result };
          }
          throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
        });
      }
      list(options = {}) {
        return withSpan(options.span, "blobs.list", (span) => {
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.method": "GET",
            "blobs.list.paginate": options.paginate ?? false
          });
          const iterator = this.getListIterator(options);
          if (options.paginate) {
            return iterator;
          }
          return collectIterator(iterator).then(
            (items) => items.reduce(
              (acc, item) => ({
                blobs: [...acc.blobs, ...item.blobs],
                directories: [...acc.directories, ...item.directories]
              }),
              { blobs: [], directories: [] }
            )
          );
        });
      }
      async set(key2, data, options = {}) {
        return withSpan(options.span, "blobs.set", async (span) => {
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key2,
            "blobs.method": "PUT",
            "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
            "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
            "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
          });
          _Store.validateKey(key2);
          const conditions = _Store.getConditions(options);
          const res = await this.client.makeRequest({
            conditions,
            body: data,
            key: key2,
            metadata: options.metadata,
            method: "put",
            storeName: this.name
          });
          const etag = res.headers.get("etag") ?? "";
          span?.setAttributes({
            "blobs.response.etag": etag,
            "blobs.response.status": res.status
          });
          if (conditions) {
            return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
          }
          if (res.status === STATUS_OK) {
            return {
              etag,
              modified: true
            };
          }
          throw await createBlobsInternalError(res, { method: "put", storeName: this.name });
        });
      }
      async setJSON(key2, data, options = {}) {
        return withSpan(options.span, "blobs.setJSON", async (span) => {
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key2,
            "blobs.method": "PUT",
            "blobs.data.type": "json",
            "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
          });
          _Store.validateKey(key2);
          const conditions = _Store.getConditions(options);
          const payload = JSON.stringify(data);
          const headers = {
            "content-type": "application/json"
          };
          const res = await this.client.makeRequest({
            conditions,
            body: payload,
            headers,
            key: key2,
            metadata: options.metadata,
            method: "put",
            storeName: this.name
          });
          const etag = res.headers.get("etag") ?? "";
          span?.setAttributes({
            "blobs.response.etag": etag,
            "blobs.response.status": res.status
          });
          if (conditions) {
            return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
          }
          if (res.status === STATUS_OK) {
            return {
              etag,
              modified: true
            };
          }
          throw new BlobsInternalError(res, { method: "put", storeName: this.name });
        });
      }
      static formatListResultBlob(result) {
        if (!result.key) {
          return null;
        }
        return {
          etag: result.etag,
          key: result.key
        };
      }
      static getConditions(options) {
        if ("onlyIfMatch" in options && "onlyIfNew" in options) {
          throw new Error(
            `The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key.`
          );
        }
        if ("onlyIfMatch" in options && options.onlyIfMatch) {
          if (typeof options.onlyIfMatch !== "string") {
            throw new Error(`The 'onlyIfMatch' property expects a string representing an ETag.`);
          }
          return {
            onlyIfMatch: options.onlyIfMatch
          };
        }
        if ("onlyIfNew" in options && options.onlyIfNew) {
          if (typeof options.onlyIfNew !== "boolean") {
            throw new Error(
              `The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists.`
            );
          }
          return {
            onlyIfNew: true
          };
        }
      }
      static validateKey(key2) {
        if (key2 === "") {
          throw new Error("Blob key must not be empty.");
        }
        if (key2.startsWith("/") || key2.startsWith("%2F")) {
          throw new Error("Blob key must not start with forward slash (/).");
        }
        if (new TextEncoder().encode(key2).length > 600) {
          throw new Error(
            "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
          );
        }
      }
      static validateDeployID(deployID) {
        if (!/^\w{1,24}$/.test(deployID)) {
          throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
        }
      }
      static validateStoreName(name) {
        if (name.includes("/") || name.includes("%2F")) {
          throw new Error("Store name must not contain forward slashes (/).");
        }
        if (new TextEncoder().encode(name).length > 64) {
          throw new Error(
            "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
          );
        }
      }
      getListIterator(options) {
        const { client, name: storeName } = this;
        const parameters = {};
        if (options?.prefix) {
          parameters.prefix = options.prefix;
        }
        if (options?.directories) {
          parameters.directories = "true";
        }
        return {
          [Symbol.asyncIterator]() {
            let currentCursor = null;
            let done = false;
            return {
              async next() {
                return withSpan(options?.span, "blobs.list.next", async (span) => {
                  span?.setAttributes({
                    "blobs.store": storeName,
                    "blobs.method": "GET",
                    "blobs.list.paginate": options?.paginate ?? false,
                    "blobs.list.done": done,
                    "blobs.list.cursor": currentCursor ?? void 0
                  });
                  if (done) {
                    return { done: true, value: void 0 };
                  }
                  const nextParameters = { ...parameters };
                  if (currentCursor !== null) {
                    nextParameters.cursor = currentCursor;
                  }
                  const res = await client.makeRequest({
                    method: "get",
                    parameters: nextParameters,
                    storeName
                  });
                  span?.setAttributes({
                    "blobs.response.status": res.status
                  });
                  let blobs = [];
                  let directories = [];
                  if (![200, 204, 404].includes(res.status)) {
                    throw new BlobsInternalError(res);
                  }
                  if (res.status === 404) {
                    done = true;
                  } else {
                    const page = await res.json();
                    if (page.next_cursor) {
                      currentCursor = page.next_cursor;
                    } else {
                      done = true;
                    }
                    blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean);
                    directories = page.directories ?? [];
                  }
                  return {
                    done: false,
                    value: {
                      blobs,
                      directories
                    }
                  };
                });
              }
            };
          }
        };
      }
    };
    getDeployStoreRegion = (clientOptions, context) => {
      if (clientOptions.region) {
        return clientOptions.region;
      }
      if (clientOptions.edgeURL || clientOptions.uncachedEdgeURL) {
        if (!context.primaryRegion) {
          throw new Error(
            "When accessing a deploy store, the Netlify Blobs client needs to be configured with a region, and one was not found in the environment. To manually set the region, set the `region` property in the store options. If you are using the Netlify CLI, you may have an outdated version; run `npm install -g netlify-cli@latest` to update and try again."
          );
        }
        return context.primaryRegion;
      }
      return REGION_AUTO;
    };
    getDeployStore = (input = {}, options) => {
      const context = getEnvironmentContext();
      const mergedOptions = typeof input === "string" ? { ...options, name: input } : input;
      const deployID = mergedOptions.deployID ?? context.deployID;
      if (!deployID) {
        throw new MissingBlobsEnvironmentError(["deployID"]);
      }
      const clientOptions = getClientOptions(mergedOptions, context);
      clientOptions.region = getDeployStoreRegion(clientOptions, context);
      const client = new Client(clientOptions);
      return new Store({ client, deployID, name: mergedOptions.name });
    };
    getStore = (input, options) => {
      if (typeof input === "string") {
        const contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0;
        const clientOptions = getClientOptions(options ?? {}, contextOverride);
        const client = new Client(clientOptions);
        return new Store({ client, name: input });
      }
      if (typeof input?.name === "string") {
        const { name } = input;
        const contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0;
        const clientOptions = getClientOptions(input, contextOverride);
        if (!name) {
          throw new MissingBlobsEnvironmentError(["name"]);
        }
        const client = new Client(clientOptions);
        return new Store({ client, name });
      }
      if (typeof input?.deployID === "string") {
        const context = getEnvironmentContext();
        const clientOptions = getClientOptions(input, context);
        const { deployID } = input;
        if (!deployID) {
          throw new MissingBlobsEnvironmentError(["deployID"]);
        }
        clientOptions.region = getDeployStoreRegion(clientOptions, context);
        const client = new Client(clientOptions);
        return new Store({ client, deployID });
      }
      throw new Error(
        "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
      );
    };
    formatListStoreResponse = (stores2) => stores2.filter((store) => !store.startsWith(DEPLOY_STORE_PREFIX)).map((store) => store.startsWith(SITE_STORE_PREFIX) ? store.slice(SITE_STORE_PREFIX.length) : store);
    getListIterator = (client, prefix) => {
      const parameters = {
        prefix
      };
      return {
        [Symbol.asyncIterator]() {
          let currentCursor = null;
          let done = false;
          return {
            async next() {
              if (done) {
                return { done: true, value: void 0 };
              }
              const nextParameters = { ...parameters };
              if (currentCursor !== null) {
                nextParameters.cursor = currentCursor;
              }
              const res = await client.makeRequest({
                method: "get",
                parameters: nextParameters
              });
              if (res.status === 404) {
                return { done: true, value: void 0 };
              }
              const page = await res.json();
              if (page.next_cursor) {
                currentCursor = page.next_cursor;
              } else {
                done = true;
              }
              return {
                done: false,
                value: {
                  ...page,
                  stores: formatListStoreResponse(page.stores)
                }
              };
            }
          };
        }
      };
    };
  }
});

// server/lib/store.ts
var store_exports = {};
__export(store_exports, {
  CACHE_VERSION: () => CACHE_VERSION,
  cached: () => cached,
  invalidate: () => invalidate,
  kv: () => kv,
  resetStoresForTests: () => resetStoresForTests
});
import { promises as fs } from "node:fs";
import path from "node:path";
function kv(name = "core") {
  if (stores.has(name)) return stores.get(name);
  let s;
  if (process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT) s = new BlobsKV("pmos-" + name);
  else if (process.env.VITEST || process.env.PMOS_MEMORY_STORE === "1") s = new MemoryKV();
  else s = new FileKV(path.resolve(process.cwd(), ".data", name));
  stores.set(name, s);
  return s;
}
function resetStoresForTests() {
  stores.clear();
}
async function cached(rawKey2, ttlSec, fn, opts = {}) {
  const key2 = CACHE_VERSION + ":" + rawKey2;
  const now = Date.now();
  if (!opts.force) {
    const m = mem.get(key2);
    if (m && m.exp > now) return { value: m.v.value, cachedAt: m.v.cachedAt, fromCache: true };
    const s = await kv("cache").get(key2).catch(() => null);
    if (s && s.exp > now) {
      mem.set(key2, { exp: s.exp, v: s });
      return { value: s.value, cachedAt: s.cachedAt, fromCache: true };
    }
  }
  const value = await fn();
  const rec = { exp: now + ttlSec * 1e3, value, cachedAt: new Date(now).toISOString() };
  mem.set(key2, { exp: rec.exp, v: rec });
  if (mem.size > 500) {
    const first = mem.keys().next().value;
    if (first) mem.delete(first);
  }
  await kv("cache").set(key2, rec).catch(() => void 0);
  return { value, cachedAt: rec.cachedAt, fromCache: false };
}
async function invalidate(rawPrefix) {
  const prefix = CACHE_VERSION + ":" + rawPrefix;
  [...mem.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => mem.delete(k));
  const keys = await kv("cache").list(prefix).catch(() => []);
  await Promise.all(keys.map((k) => kv("cache").del(k)));
}
var MemoryKV, FileKV, BlobsKV, stores, mem, CACHE_VERSION;
var init_store = __esm({
  "server/lib/store.ts"() {
    "use strict";
    MemoryKV = class {
      m = /* @__PURE__ */ new Map();
      async get(k) {
        const v2 = this.m.get(k);
        return v2 === void 0 ? null : JSON.parse(v2);
      }
      async set(k, v2) {
        this.m.set(k, JSON.stringify(v2));
      }
      async del(k) {
        this.m.delete(k);
      }
      async list(p) {
        return [...this.m.keys()].filter((k) => k.startsWith(p)).sort();
      }
    };
    FileKV = class {
      constructor(dir) {
        this.dir = dir;
      }
      dir;
      file(k) {
        return path.join(this.dir, encodeURIComponent(k) + ".json");
      }
      async get(k) {
        try {
          return JSON.parse(await fs.readFile(this.file(k), "utf8"));
        } catch {
          return null;
        }
      }
      async set(k, v2) {
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(this.file(k), JSON.stringify(v2));
      }
      async del(k) {
        try {
          await fs.unlink(this.file(k));
        } catch {
        }
      }
      async list(p) {
        try {
          return (await fs.readdir(this.dir)).map((f) => decodeURIComponent(f.replace(/\.json$/, ""))).filter((k) => k.startsWith(p)).sort();
        } catch {
          return [];
        }
      }
    };
    BlobsKV = class {
      storeP;
      constructor(name) {
        this.storeP = Promise.resolve().then(() => (init_main3(), main_exports)).then((m) => m.getStore({ name, consistency: "strong" }));
      }
      async get(k) {
        const s = await this.storeP;
        return await s.get(k, { type: "json" }) ?? null;
      }
      async set(k, v2) {
        const s = await this.storeP;
        await s.setJSON(k, v2);
      }
      async del(k) {
        const s = await this.storeP;
        await s.delete(k);
      }
      async list(p) {
        const s = await this.storeP;
        const out = [];
        for await (const page of s.list({ prefix: p, paginate: true })) page.blobs.forEach((b) => out.push(b.key));
        return out.sort();
      }
    };
    stores = /* @__PURE__ */ new Map();
    mem = /* @__PURE__ */ new Map();
    CACHE_VERSION = "v7";
  }
});

// server/meta/errors.ts
function redactEndpoint(url) {
  return url.replace(/(access_token|appsecret_proof|client_secret|fb_exchange_token|input_token)=[^&]+/g, "$1=***").replace(/^https:\/\/graph\.facebook\.com/, "");
}
function diagnose(p) {
  if (p.network) {
    return {
      endpoint: redactEndpoint(p.endpoint),
      method: p.method,
      message: p.network,
      category: "network",
      cause: "No hubo respuesta de Meta (red o tiempo de espera).",
      recommendation: "Vuelve a intentar. Si era una creaci\xF3n, revisa en Ads Manager antes de reintentar para no duplicar.",
      retryable: p.method === "GET"
    };
  }
  const e = p.body && p.body.error || {};
  const code = e.code !== void 0 ? Number(e.code) : void 0;
  const sub = e.error_subcode !== void 0 ? Number(e.error_subcode) : void 0;
  let ed = e.error_data;
  if (typeof ed === "string") {
    try {
      ed = JSON.parse(ed);
    } catch {
      ed = null;
    }
  }
  const blame = ed && ed.blame_field_specs ? [].concat(...ed.blame_field_specs.map((b) => [].concat(b))).map(String) : [];
  const k = KNOWN[`${code}:${sub ?? ""}`] || KNOWN[`${code}:`] || null;
  let category = k?.category || (p.httpStatus && p.httpStatus >= 500 ? "transient" : "unknown");
  if (code !== void 0 && RATE_CODES.includes(code)) category = "rate_limit";
  if (e.is_transient === true && category === "unknown") category = "transient";
  const msg = String(e.message || (p.httpStatus ? "HTTP " + p.httpStatus : "Error desconocido"));
  let cause = k?.cause || "Meta devolvi\xF3 un error sin clasificar.";
  let recommendation = k?.recommendation || "Lee el mensaje original de Meta. Si no es claro, comparte el fbtrace_id con soporte de Meta.";
  if (/terms of service|leadgen.*tos/i.test(msg)) {
    category = "incompatible_config";
    cause = "La p\xE1gina no acept\xF3 las condiciones de Lead Ads.";
    recommendation = "Un administrador de la p\xE1gina debe aceptarlas en https://www.facebook.com/ads/leadgen/tos";
  }
  if (/ad account.*(disabled|deshabilitada)|account is disabled|cuenta.*inhabilitada/i.test(msg)) {
    category = "account_restricted";
    cause = "La cuenta publicitaria est\xE1 deshabilitada o restringida.";
    recommendation = "Revisa el estado en Business Support Home; no se puede resolver reintentando.";
  }
  if (/does not exist|no existe|cannot be loaded due to missing permissions/i.test(msg) && code === 100) {
    category = "asset_access";
    cause = "El objeto no existe o el token no tiene acceso a \xE9l.";
    recommendation = "Asigna el activo al system user en Business Manager o verifica el ID.";
  }
  return {
    endpoint: redactEndpoint(p.endpoint),
    method: p.method,
    httpStatus: p.httpStatus,
    code,
    subcode: sub,
    type: e.type,
    message: msg,
    userTitle: e.error_user_title || void 0,
    userMessage: e.error_user_msg || void 0,
    fbtraceId: e.fbtrace_id,
    blameFields: blame.length ? blame : void 0,
    category,
    cause,
    recommendation,
    retryable: category === "rate_limit" || category === "transient" && p.method === "GET" || !!(k?.retryable && p.method === "GET")
  };
}
function waitFromHeaders(h) {
  let min = 0;
  for (const k of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
    const v2 = h.get(k);
    if (!v2) continue;
    try {
      const o = JSON.parse(v2);
      const vals = Array.isArray(o) ? o : [].concat(...Object.values(o).map((x) => [].concat(x)));
      [...vals, o].forEach((x) => {
        const m = Number((x || {}).estimated_time_to_regain_access || 0);
        if (m > min) min = m;
      });
    } catch {
    }
  }
  return min * 60;
}
function usageFromHeaders(h) {
  const vals = [];
  const read = (k) => {
    const v2 = h.get(k);
    if (!v2) return null;
    try {
      return JSON.parse(v2);
    } catch {
      return null;
    }
  };
  const buc = read("x-business-use-case-usage");
  if (buc) [].concat(...Object.values(buc)).forEach((x) => vals.push(x.call_count || 0, x.total_cputime || 0, x.total_time || 0));
  const app = read("x-app-usage");
  if (app) vals.push(app.call_count || 0, app.total_cputime || 0, app.total_time || 0);
  const acc = read("x-ad-account-usage");
  if (acc) vals.push(Number(acc.acc_id_util_pct) || 0);
  return vals.length ? Math.max(...vals) : 0;
}
var KNOWN, RATE_CODES, MetaApiError;
var init_errors = __esm({
  "server/meta/errors.ts"() {
    "use strict";
    KNOWN = {
      "190:463": { category: "token_expired", cause: "El token de acceso venci\xF3.", recommendation: "Genera un token nuevo (system user sin vencimiento) o reconecta Meta en Conexi\xF3n con Meta." },
      "190:460": { category: "token_invalid", cause: "El usuario cambi\xF3 su contrase\xF1a o cerr\xF3 sesiones: el token qued\xF3 invalidado.", recommendation: "Reconecta Meta con Facebook Login o usa un token de system user." },
      "190:458": { category: "token_invalid", cause: "El usuario quit\xF3 la app de su cuenta.", recommendation: "Vuelve a autorizar la app en Conexi\xF3n con Meta." },
      "190:459": { category: "account_restricted", cause: "El usuario de Facebook tiene un punto de control de seguridad pendiente.", recommendation: "El due\xF1o del token debe iniciar sesi\xF3n en facebook.com y completar la verificaci\xF3n." },
      "190:464": { category: "account_restricted", cause: "El usuario de Facebook no est\xE1 confirmado.", recommendation: "Confirma la cuenta de Facebook del due\xF1o del token." },
      "190:492": { category: "token_invalid", cause: "La sesi\xF3n del usuario ya no es v\xE1lida para esta p\xE1gina/negocio.", recommendation: "Reconecta Meta." },
      "190:": { category: "token_invalid", cause: "El token de acceso no es v\xE1lido (vencido, revocado o mal copiado).", recommendation: 'Revisa META_ACCESS_TOKEN en Netlify o reconecta en Conexi\xF3n con Meta; usa el "Chequeo de Meta" para ver el detalle.' },
      "102:": { category: "token_invalid", cause: "La sesi\xF3n de la API no es v\xE1lida.", recommendation: "Reconecta Meta." },
      "10:": { category: "permission_missing", cause: "El token no tiene el permiso necesario para esta acci\xF3n.", recommendation: "Regenera el token con los permisos que indica el Chequeo de Meta (ads_management, business_management, etc.)." },
      "200:": { category: "permission_missing", cause: "Falta un permiso o el usuario no tiene rol sobre el activo.", recommendation: "En Business Manager asigna el activo (cuenta, p\xE1gina, p\xEDxel o WABA) al system user con el rol adecuado." },
      "294:": { category: "permission_missing", cause: "La app no tiene acceso avanzado a la Marketing API.", recommendation: 'Solicita "Ads Management Standard Access" en la revisi\xF3n de la app.' },
      "275:": { category: "asset_access", cause: "No se puede acceder al objeto con este token.", recommendation: "Comparte el activo con el system user o con la cuenta publicitaria." },
      "803:": { category: "not_found", cause: "El objeto o alias no existe.", recommendation: "Verifica el ID; pudo haberse eliminado." },
      "100:33": { category: "asset_access", cause: "El objeto no existe o el token no tiene acceso a \xE9l.", recommendation: "Confirma el ID y que el activo est\xE9 asignado al system user en Business Manager." },
      "368:": { category: "policy", cause: "Acci\xF3n bloqueada por pol\xEDticas o integridad de Meta.", recommendation: "Revisa la calidad de la cuenta en Business Support Home." },
      "1:": { category: "transient", cause: "Error interno temporal de Meta.", recommendation: "Vuelve a intentar en unos minutos.", retryable: true },
      "2:": { category: "transient", cause: "El servicio de Meta no est\xE1 disponible moment\xE1neamente.", recommendation: "Vuelve a intentar en unos minutos.", retryable: true },
      "4:": { category: "rate_limit", cause: "L\xEDmite de llamadas de la app.", recommendation: "Espera unos minutos; la herramienta reintenta con espera creciente.", retryable: true },
      "17:": { category: "rate_limit", cause: "L\xEDmite de llamadas del usuario.", recommendation: "Espera unos minutos.", retryable: true },
      "32:": { category: "rate_limit", cause: "L\xEDmite de llamadas de la p\xE1gina.", recommendation: "Espera unos minutos.", retryable: true },
      "613:": { category: "rate_limit", cause: "Demasiadas llamadas a la cuenta en poco tiempo.", recommendation: "Espera unos minutos; reduce el tama\xF1o de los lotes.", retryable: true },
      "80000:": { category: "rate_limit", cause: "L\xEDmite de uso de la cuenta publicitaria (Business Use Case).", recommendation: "Espera el tiempo que indica Meta.", retryable: true },
      "80004:": { category: "rate_limit", cause: "L\xEDmite de uso de Ads Management de la cuenta.", recommendation: "Espera el tiempo que indica Meta.", retryable: true },
      "2635:": { category: "invalid_parameter", cause: "La versi\xF3n de la API ya no est\xE1 disponible.", recommendation: "Cambia META_API_VERSION a v26.0 (la versi\xF3n vigente)." },
      "2500:": { category: "invalid_parameter", cause: "Error de sintaxis en la solicitud.", recommendation: "Reporta el caso con el fbtrace_id." },
      "100:1885183": { category: "app_mode", cause: "La app de Meta est\xE1 en modo desarrollo: no puede publicar anuncios.", recommendation: "En developers.facebook.com pasa la app a modo Live." },
      "100:2490408": { category: "incompatible_config", cause: "Meta no acepta ese objetivo de rendimiento (optimization_goal) con el objetivo de la campa\xF1a o el destino.", recommendation: 'Con WhatsApp: Ventas admite Conversiones con el dataset de WhatsApp y Conversaciones; Interacci\xF3n admite Conversaciones y Clics. Usa "Verificar con Meta" para ver qu\xE9 acepta tu cuenta.' },
      "100:2446886": { category: "incompatible_config", cause: "La p\xE1gina no tiene una cuenta de WhatsApp vinculada.", recommendation: "Vincula el n\xFAmero de WhatsApp Business en la p\xE1gina (Configuraci\xF3n \u2192 Cuentas vinculadas \u2192 WhatsApp)." },
      "100:1487246": { category: "incompatible_config", cause: "El n\xFAmero de WhatsApp no est\xE1 vinculado a la p\xE1gina o a la cuenta.", recommendation: "Elige un n\xFAmero vinculado a la p\xE1gina o d\xE9jalo vac\xEDo para usar el de la p\xE1gina." },
      "100:4834011": { category: "invalid_parameter", cause: "Con presupuesto por conjunto (ABO) Meta exige is_adset_budget_sharing_enabled.", recommendation: "La herramienta lo env\xEDa siempre; si aparece, reporta el caso." },
      "100:1815857": { category: "incompatible_config", cause: "La estrategia de puja con tope exige un monto en el conjunto.", recommendation: "Indica el monto de puja o cambia a costo m\xE1s bajo." },
      "100:1885760": { category: "incompatible_config", cause: "En campa\xF1as con presupuesto de campa\xF1a (CBO) y costo m\xE1s bajo, todos los conjuntos deben optimizar igual.", recommendation: "Usa la misma optimizaci\xF3n en todos los conjuntos o cambia a presupuesto por conjunto." },
      "100:1885272": { category: "invalid_parameter", cause: "El presupuesto es menor al m\xEDnimo permitido.", recommendation: "Sube el presupuesto al m\xEDnimo de la cuenta." },
      "100:1885650": { category: "invalid_parameter", cause: "El presupuesto es demasiado bajo para la duraci\xF3n o la puja.", recommendation: "Sube el presupuesto o acorta la duraci\xF3n." },
      "100:1487851": { category: "invalid_parameter", cause: "Fecha de fin inv\xE1lida o anterior al inicio.", recommendation: "Revisa las fechas del conjunto." },
      "100:1487390": { category: "invalid_parameter", cause: "El creativo tiene un problema (imagen, video o texto).", recommendation: "Revisa el campo se\xF1alado por Meta." },
      "100:1885204": { category: "invalid_parameter", cause: "La ubicaci\xF3n seleccionada no es compatible con el objetivo u optimizaci\xF3n.", recommendation: "Usa ubicaciones Advantage+ o quita la ubicaci\xF3n se\xF1alada." },
      "100:3858082": { category: "invalid_parameter", cause: "La segmentaci\xF3n detallada no es compatible (intereses retirados o categor\xEDa especial).", recommendation: "Quita los intereses se\xF1alados." },
      "100:": { category: "invalid_parameter", cause: "Meta rechaz\xF3 un par\xE1metro de la solicitud.", recommendation: "Revisa el campo que se\xF1ala Meta y el mensaje original." },
      "1487390:": { category: "invalid_parameter", cause: "Error en el creativo.", recommendation: "Revisa el mensaje de Meta." }
    };
    RATE_CODES = [4, 17, 32, 613, 8e4, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014];
    MetaApiError = class extends Error {
      info;
      waitSeconds;
      constructor(info, waitSeconds = 0) {
        super(info.message);
        this.name = "MetaApiError";
        this.info = info;
        this.waitSeconds = waitSeconds;
      }
    };
  }
});

// server/meta/client.ts
function setTransport(t) {
  transport = t;
}
function sleep2(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function logMetaError(info, label) {
  const at = (/* @__PURE__ */ new Date()).toISOString();
  await kv("audit").set("metaerr/" + at.slice(0, 10) + "/" + at.replace(/[-:.TZ]/g, "") + "-" + randomId(4), { at, label, ...info }).catch(() => void 0);
}
async function recentMetaErrors(days = 3, limit = 200) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const keys = (await kv("audit").list("metaerr/")).filter((k) => k.split("/")[1] >= since).reverse().slice(0, limit);
  return (await Promise.all(keys.map((k) => kv("audit").get(k)))).filter(Boolean);
}
var transport, MAX_WAIT_MS, Graph;
var init_client = __esm({
  "server/meta/client.ts"() {
    "use strict";
    init_env();
    init_crypto();
    init_store();
    init_errors();
    transport = (u, i) => fetch(u, i);
    MAX_WAIT_MS = 9e3;
    Graph = class {
      constructor(token, opts = {}) {
        this.token = token;
        this.opts = opts;
        this.base = `https://graph.facebook.com/${opts.version || env.metaVersion}/`;
        const secret = opts.appSecret ?? env.metaAppSecret;
        if (secret && token && env.metaMode !== "mock") this.proof = hmacHex(secret, token);
      }
      token;
      opts;
      base;
      proof;
      lastUsage = 0;
      async url(path2, params) {
        const u = new URL(path2.startsWith("http") ? path2 : this.base + path2.replace(/^\//, ""));
        if (params) Object.entries(params).forEach(([k, v2]) => {
          if (v2 === void 0 || v2 === null) return;
          u.searchParams.set(k, typeof v2 === "object" ? JSON.stringify(v2) : String(v2));
        });
        if (this.proof && !u.searchParams.has("appsecret_proof")) u.searchParams.set("appsecret_proof", await this.proof);
        return u.toString();
      }
      async request(method, path2, params, attempt = 0, waited = 0) {
        const isRead = method === "GET";
        const url = await this.url(path2, isRead || method === "DELETE" ? params : void 0);
        const init = { method, headers: { Authorization: "Bearer " + this.token } };
        if (method === "POST") {
          const body2 = new URLSearchParams();
          Object.entries(params || {}).forEach(([k, v2]) => {
            if (v2 === void 0 || v2 === null || v2 === "") return;
            body2.set(k, typeof v2 === "object" ? JSON.stringify(v2) : String(v2));
          });
          init.headers["Content-Type"] = "application/x-www-form-urlencoded";
          init.body = body2.toString();
        }
        const t0 = Date.now();
        let res;
        try {
          res = await transport(url, { ...init, signal: AbortSignal.timeout(isRead ? 2e4 : 25e3) });
        } catch (e) {
          const info = diagnose({ endpoint: url, method, network: "Sin respuesta de Meta: " + String(e?.message || e).slice(0, 160) });
          if (isRead && attempt < 2 && waited < MAX_WAIT_MS) {
            await sleep2(800 * (attempt + 1));
            return this.request(method, path2, params, attempt + 1, waited + 800 * (attempt + 1));
          }
          await logMetaError(info, this.opts.label);
          throw new MetaApiError(info);
        }
        this.lastUsage = usageFromHeaders(res.headers);
        const text = await res.text();
        let body;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { raw: text.slice(0, 500) };
        }
        const ms = Date.now() - t0;
        if (!res.ok || body && body.error) {
          const info = diagnose({ endpoint: url, method, httpStatus: res.status, body });
          const wait = waitFromHeaders(res.headers);
          console.warn("[meta]", JSON.stringify({ method, endpoint: info.endpoint, status: res.status, code: info.code, subcode: info.subcode, ms, fbtrace: info.fbtraceId, category: info.category }));
          if (info.retryable && attempt < 4) {
            const delay = wait > 0 ? wait * 1e3 : Math.min(8e3, 2 ** attempt * 1e3) + Math.random() * 400;
            if (waited + delay <= MAX_WAIT_MS) {
              await sleep2(delay);
              return this.request(method, path2, params, attempt + 1, waited + delay);
            }
          }
          await logMetaError(info, this.opts.label);
          throw new MetaApiError(info, wait);
        }
        if (this.lastUsage >= 90) await sleep2(1500);
        return body;
      }
      get(path2, params) {
        return this.request("GET", path2, params);
      }
      post(path2, params) {
        return this.request("POST", path2, params);
      }
      del(path2, params) {
        return this.request("DELETE", path2, params);
      }
      /** Todas las páginas de una conexión (tope de seguridad por número de páginas). */
      async all(path2, params = {}, maxPages = 20) {
        const out = [];
        let next = null;
        let first = true;
        for (let i = 0; i < maxPages; i++) {
          const r = first ? await this.get(path2, { limit: 200, ...params }) : await this.get(next);
          first = false;
          (r.data || []).forEach((x) => out.push(x));
          next = r.paging?.next || null;
          if (!next) break;
        }
        return out;
      }
      /** Una página con cursor (para listas grandes con carga diferida). */
      async page(path2, params = {}, after) {
        const r = await this.get(path2, { limit: 100, ...params, ...after ? { after } : {} });
        return { data: r.data || [], next: r.paging?.cursors?.after && r.paging?.next ? r.paging.cursors.after : void 0 };
      }
      /** API de lotes: hasta 50 solicitudes por llamada. Devuelve el cuerpo o el error de cada una. */
      async batch(requests) {
        const out = [];
        for (let i = 0; i < requests.length; i += 50) {
          const chunk = requests.slice(i, i + 50).map((r) => ({
            method: r.method,
            relative_url: r.relative_url,
            ...r.body ? { body: new URLSearchParams(Object.entries(r.body).filter(([, v2]) => v2 !== void 0 && v2 !== null).map(([k, v2]) => [k, typeof v2 === "object" ? JSON.stringify(v2) : String(v2)])).toString() } : {}
          }));
          const res = await this.post("", { batch: chunk, include_headers: false });
          (res || []).forEach((x, j) => {
            let body = null;
            try {
              body = x && x.body ? JSON.parse(x.body) : null;
            } catch {
              body = x?.body;
            }
            if (x && Number(x.code) >= 200 && Number(x.code) < 300 && !(body && body.error)) out.push({ ok: true, body });
            else {
              const info = diagnose({ endpoint: this.base + chunk[j].relative_url, method: chunk[j].method, httpStatus: Number(x?.code) || 0, body });
              out.push({ ok: false, body, error: new MetaApiError(info) });
            }
          });
        }
        return out;
      }
    };
  }
});

// shared/currency.ts
var currency_exports = {};
__export(currency_exports, {
  currencyOffset: () => currencyOffset,
  formatMoney: () => formatMoney,
  formatNumber: () => formatNumber,
  formatPct: () => formatPct,
  toMajor: () => toMajor,
  toMinor: () => toMinor
});
function currencyOffset(currency) {
  return OFFSET_1.includes(String(currency || "").toUpperCase()) ? 1 : 100;
}
function toMinor(value, currency) {
  const n2 = Number(value);
  if (!isFinite(n2) || value === null || value === void 0 || value === "") return null;
  return Math.round(n2 * currencyOffset(currency));
}
function toMajor(value, currency) {
  if (value === null || value === void 0 || value === "") return null;
  const n2 = Number(value);
  return isFinite(n2) ? n2 / currencyOffset(currency) : null;
}
function formatMoney(v2, currency = "MXN", compact = false) {
  if (v2 === null || v2 === void 0 || !isFinite(v2)) return "\u2014";
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: compact || Math.abs(v2) >= 1e3 ? 0 : 2,
      notation: compact && Math.abs(v2) >= 1e5 ? "compact" : "standard"
    }).format(v2);
  } catch {
    return "$" + v2.toFixed(2);
  }
}
function formatNumber(v2, digits = 0) {
  if (v2 === null || v2 === void 0 || !isFinite(v2)) return "\u2014";
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v2);
}
function formatPct(v2, digits = 1) {
  if (v2 === null || v2 === void 0 || !isFinite(v2)) return "\u2014";
  return formatNumber(v2, digits) + " %";
}
var OFFSET_1;
var init_currency = __esm({
  "shared/currency.ts"() {
    "use strict";
    OFFSET_1 = [
      "JPY",
      "KRW",
      "CLP",
      "VND",
      "COP",
      "ISK",
      "HUF",
      "TWD",
      "PYG",
      "UGX",
      "RWF",
      "XAF",
      "XOF",
      "XPF",
      "BIF",
      "DJF",
      "GNF",
      "KMF",
      "MGA",
      "VUV",
      "CRC",
      "IDR"
    ];
  }
});

// server/meta/whatsapp.ts
var whatsapp_exports = {};
__export(whatsapp_exports, {
  discoverWabas: () => discoverWabas,
  numberKey: () => numberKey,
  prettyNumber: () => prettyNumber,
  whatsappInfo: () => whatsappInfo
});
function numberKey(v2) {
  let d = String(v2 || "").replace(/\D/g, "");
  if (/^521\d{10}$/.test(d)) d = "52" + d.slice(3);
  return d.length >= 8 ? d : "";
}
function prettyNumber(v2) {
  const s = String(v2 || "").trim();
  if (/\s/.test(s)) return s;
  const d = s.replace(/\D/g, "");
  if (/^521\d{10}$/.test(d)) return d.replace(/^(\d{2})(\d)(\d{2})(\d{4})(\d{4})$/, "+$1 $2 $3 $4 $5");
  if (/^52\d{10}$/.test(d)) return d.replace(/^(\d{2})(\d{2})(\d{4})(\d{4})$/, "+$1 $2 $3 $4");
  if (/^57\d{10}$/.test(d)) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})$/, "+$1 $2 $3 $4");
  if (/^1\d{10}$/.test(d)) return d.replace(/^(\d)(\d{3})(\d{3})(\d{4})$/, "+$1 $2-$3-$4");
  return "+" + d;
}
async function discoverWabas(g, accountId, errors) {
  const act = actId(accountId);
  const businesses2 = /* @__PURE__ */ new Map();
  try {
    const a = await g.get(act, { fields: "business{id,name}" });
    if (a.business) businesses2.set(a.business.id, a.business.name || "due\xF1o de la cuenta");
  } catch (e) {
    errors.push("Portafolio de la cuenta: " + errText(e));
  }
  try {
    (await g.all("me/businesses", { fields: "id,name" }, 5)).forEach((b) => businesses2.set(b.id, b.name || b.id));
  } catch (e) {
    errors.push("Portafolios del token: " + errText(e));
  }
  const direct = /* @__PURE__ */ new Map();
  try {
    const dbg = (await g.get("debug_token", { input_token: g.token })).data || {};
    (dbg.granular_scopes || []).forEach((gs) => {
      const ids = (gs.target_ids || []).map(String);
      if (/^whatsapp_business_(management|messaging)$/.test(gs.scope)) ids.forEach((id) => direct.set(id, "asignada al token"));
      if (gs.scope === "business_management") ids.forEach((id) => {
        if (!businesses2.has(id)) businesses2.set(id, "portafolio " + id);
      });
    });
  } catch {
  }
  env.metaWabaIds.forEach((id) => {
    if (!direct.has(id)) direct.set(id, "configurada (META_WABA_IDS)");
  });
  const wabas = /* @__PURE__ */ new Map();
  await Promise.all([...businesses2.entries()].slice(0, 20).map(async ([bid, bname]) => {
    for (const [edge, relation] of [["owned_whatsapp_business_accounts", "propia"], ["client_whatsapp_business_accounts", "de cliente"]]) {
      try {
        (await g.all(`${bid}/${edge}`, { fields: "id,name" }, 5)).forEach((w) => {
          if (!wabas.has(w.id)) wabas.set(w.id, { id: w.id, name: w.name || w.id, business: bname, relation });
        });
      } catch (e) {
        errors.push(`${bname} (${relation === "propia" ? "WABA propias" : "WABA de clientes"}): ${errText(e)}`);
      }
    }
  }));
  await Promise.all([...direct.entries()].filter(([id]) => !wabas.has(id)).slice(0, 20).map(async ([id, relation]) => {
    try {
      const w = await g.get(id, { fields: "id,name" });
      wabas.set(id, { id, name: w.name || id, business: "\u2014", relation });
    } catch (e) {
      errors.push(`WABA ${id} (${relation}): ${errText(e)}`);
    }
  }));
  return { wabas: [...wabas.values()], businesses: [...businesses2.values()], direct: direct.size };
}
async function whatsappInfo(g, accountId, force2 = false) {
  const act = actId(accountId);
  return cached("wa:" + act, 600, async () => {
    const errors = [];
    const nums = /* @__PURE__ */ new Map();
    const addNum = (raw, source, extra = {}) => {
      const key2 = numberKey(raw);
      if (!key2) return;
      const x = nums.get(key2) || { id: "", display: prettyNumber(raw), key: key2, pages: [], sources: [], uses: 0 };
      if ((source === "CONJUNTOS" || source === "ANUNCIOS") && !x.id) x.id = String(raw).trim();
      if (!x.sources.includes(source)) x.sources.push(source);
      if (extra.page && !x.pages.includes(extra.page)) x.pages.push(extra.page);
      if (extra.uses) x.uses += extra.uses;
      if (extra.lastUsed && (!x.lastUsed || extra.lastUsed > x.lastUsed)) x.lastUsed = extra.lastUsed;
      for (const k of ["waba", "wabaId", "verifiedName", "quality", "status"]) if (extra[k]) x[k] = extra[k];
      nums.set(key2, x);
    };
    const datasets = /* @__PURE__ */ new Map();
    const addDs = (id, source, extra = {}) => {
      if (!id) return;
      const d = datasets.get(id) || { id, sources: [], events: [], uses: 0 };
      if (!d.sources.includes(source)) d.sources.push(source);
      if (extra.event && !d.events.includes(extra.event)) d.events.push(extra.event);
      if (extra.name) d.name = extra.name;
      if (extra.waba) d.waba = extra.waba;
      if (source === "CONJUNTOS") d.uses++;
      datasets.set(id, d);
    };
    let adsets = [];
    try {
      adsets = await g.all(act + "/adsets", { fields: "id,name,effective_status,updated_time,optimization_goal,destination_type,billing_event,optimization_sub_event,promoted_object,attribution_spec,bid_strategy,campaign{id,name,objective,daily_budget,lifetime_budget}", limit: 100 }, 6);
    } catch (e) {
      errors.push("Conjuntos de la cuenta: " + errText(e));
    }
    const wa = adsets.filter((a) => /WHATSAPP/.test(String(a.destination_type || "").toUpperCase()) || a.promoted_object?.whatsapp_phone_number).sort((x, y) => String(y.updated_time || "").localeCompare(String(x.updated_time || "")));
    const pageConfirm = {};
    const confirmPage = (pid, num, source) => {
      if (!pid) return;
      const p = pageConfirm[pid] || (pageConfirm[pid] = { confirmed: false, numbers: [], source: "" });
      p.confirmed = true;
      if (!p.source) p.source = source;
      if (num && !p.numbers.includes(num)) p.numbers.push(num);
    };
    const configs = wa.slice(0, 60).map((a) => {
      const po = a.promoted_object || {};
      if (po.whatsapp_phone_number) {
        addNum(po.whatsapp_phone_number, "CONJUNTOS", { page: String(po.page_id || ""), uses: 1, lastUsed: a.updated_time });
        confirmPage(String(po.page_id || ""), prettyNumber(po.whatsapp_phone_number), "conjunto existente");
      } else if (po.page_id && /ACTIVE|PAUSED/.test(String(a.effective_status))) confirmPage(String(po.page_id), "", "conjunto existente");
      if (po.pixel_id) addDs(String(po.pixel_id), "CONJUNTOS", { event: po.custom_event_type });
      const goal = String(a.optimization_goal || "").toUpperCase();
      const purchase = /PURCHASE/.test(goal) || String(po.custom_event_type || "").toUpperCase() === "PURCHASE" || goal === "OFFSITE_CONVERSIONS" || goal === "VALUE";
      const c = a.campaign || {};
      return {
        adsetId: a.id,
        adsetName: a.name,
        campaignId: c.id || "",
        campaignName: c.name || "",
        campaignCbo: !!(Number(c.daily_budget) || Number(c.lifetime_budget)),
        objective: c.objective || "",
        optimizationGoal: goal,
        destinationType: a.destination_type || "",
        billingEvent: a.billing_event || "IMPRESSIONS",
        optimizationSubEvent: a.optimization_sub_event && a.optimization_sub_event !== "NONE" ? a.optimization_sub_event : void 0,
        promotedObject: po,
        attributionSpec: a.attribution_spec || null,
        bidStrategy: a.bid_strategy,
        status: a.effective_status,
        updated: a.updated_time,
        purchase,
        score: (purchase ? 4 : 0) + (String(po.custom_event_type || "").toUpperCase() === "PURCHASE" ? 2 : 0) + (COMMON_GOALS.includes(goal) ? 0 : 1) + (a.effective_status === "ACTIVE" ? 1 : 0)
      };
    }).sort((x, y) => y.score - x.score || String(y.updated || "").localeCompare(String(x.updated || "")));
    const welcome = /* @__PURE__ */ new Map();
    if (wa.length) {
      try {
        const res = await g.batch(wa.slice(0, 25).map((a) => ({
          method: "GET",
          relative_url: `${a.id}?fields=${encodeURIComponent("promoted_object,ads.limit(3){name,creative{object_story_spec{page_id,link_data{link,call_to_action,page_welcome_message},video_data{call_to_action,page_welcome_message}}}}")}`
        })));
        res.forEach((r) => {
          if (!r.ok) return;
          for (const ad of r.body?.ads?.data || []) {
            const oss = ad.creative?.object_story_spec || {};
            const ld = oss.link_data || {}, vd = oss.video_data || {};
            const v2 = (ld.call_to_action || vd.call_to_action || {}).value || {};
            const m = String(ld.link || v2.link || "").match(/(?:phone=|wa\.me\/)(\+?\d{8,15})/);
            const num = v2.whatsapp_number || v2.whatsapp_phone_number || m && m[1] || "";
            const pg = String(oss.page_id || r.body?.promoted_object?.page_id || "");
            if (num) {
              addNum(num, "ANUNCIOS", { page: pg, uses: 1 });
              confirmPage(pg, prettyNumber(num), "anuncio existente");
            }
            let pwm = ld.page_welcome_message || vd.page_welcome_message || null;
            if (typeof pwm === "string") {
              try {
                pwm = JSON.parse(pwm);
              } catch {
                pwm = null;
              }
            }
            const mm = pwm?.text_format?.message;
            if (!mm) continue;
            const t = { greeting: String(mm.text || ""), autofill: String(mm.autofill_message?.content || ""), iceBreakers: (mm.ice_breakers || []).map((x) => String(x.title || "")).filter(Boolean) };
            const k = JSON.stringify(t);
            const w = welcome.get(k) || { ...t, uses: 0, pages: [], example: ad.name || "" };
            w.uses++;
            if (pg && !w.pages.includes(pg)) w.pages.push(pg);
            welcome.set(k, w);
          }
        });
      } catch (e) {
        errors.push("Anuncios de WhatsApp: " + errText(e));
      }
    }
    const disc = await discoverWabas(g, act, errors);
    const wabas = [];
    await Promise.all(disc.wabas.slice(0, 30).map(async (w) => {
      let n2 = 0;
      const ds = [];
      try {
        const list2 = await g.all(w.id + "/phone_numbers", { fields: "id,display_phone_number,verified_name,quality_rating,status" }, 3);
        list2.forEach((x) => {
          n2++;
          addNum(x.display_phone_number, "WABA", { waba: w.name, wabaId: w.id, verifiedName: x.verified_name, quality: x.quality_rating, status: x.status });
        });
      } catch (e) {
        errors.push(`N\xFAmeros de "${w.name}": ${errText(e)}`);
      }
      try {
        const r = await g.get(w.id + "/dataset");
        const list2 = r?.data || (r?.id ? [r] : []);
        list2.forEach((d) => {
          ds.push(String(d.id));
          addDs(String(d.id), "WABA", { name: d.name, waba: w.name });
        });
      } catch {
      }
      wabas.push({ ...w, numbers: n2, datasets: ds });
    }));
    let missingWhatsappPermission = false;
    try {
      const perms = await g.all("me/permissions", {}, 2);
      const granted = perms.filter((p) => p.status === "granted").map((p) => p.permission);
      missingWhatsappPermission = granted.length > 0 && !granted.includes("whatsapp_business_management");
    } catch {
    }
    return {
      numbers: [...nums.values()].map((x) => ({ ...x, id: x.id || "+" + x.key })).sort((a, b) => b.uses - a.uses || (b.sources.includes("WABA") ? 1 : 0) - (a.sources.includes("WABA") ? 1 : 0)),
      wabas,
      datasets: [...datasets.values()].sort((a, b) => b.uses - a.uses),
      configs,
      welcome: [...welcome.values()].sort((a, b) => b.uses - a.uses).slice(0, 30),
      pages: pageConfirm,
      diagnostics: { businesses: disc.businesses, directWabas: disc.direct, errors, adsetsScanned: adsets.length, whatsappAdsets: wa.length, missingWhatsappPermission }
    };
  }, { force: force2 });
}
var COMMON_GOALS, errText;
var init_whatsapp = __esm({
  "server/meta/whatsapp.ts"() {
    "use strict";
    init_store();
    init_assets();
    COMMON_GOALS = ["CONVERSATIONS", "LINK_CLICKS", "IMPRESSIONS", "REACH", "POST_ENGAGEMENT", "LANDING_PAGE_VIEWS", "THRUPLAY"];
    errText = (e) => `${e?.info?.message || e?.message || e}${e?.info?.code ? ` [${e.info.code}${e.info.subcode ? "/" + e.info.subcode : ""}]` : ""}`;
  }
});

// server/meta/assets.ts
var assets_exports = {};
__export(assets_exports, {
  ACCOUNT_STATUS: () => ACCOUNT_STATUS,
  AUDIENCE_SUBTYPE: () => AUDIENCE_SUBTYPE,
  DISABLE_REASON: () => DISABLE_REASON,
  account: () => account,
  accountAssets: () => accountAssets,
  actId: () => actId,
  adAccounts: () => adAccounts,
  audiences: () => audiences,
  businesses: () => businesses,
  datasetQuality: () => datasetQuality,
  mapAccount: () => mapAccount,
  mapAudience: () => mapAudience,
  pageToken: () => pageToken,
  pixelStats: () => pixelStats
});
async function businesses(g, force2 = false) {
  return cached("biz:list", TTL.accounts, async () => {
    const list2 = await g.all("me/businesses", { fields: "id,name,verification_status,created_time" }).catch((e) => {
      if (e.info?.category === "permission_missing") return [];
      throw e;
    });
    return list2.map((b) => ({ id: b.id, name: b.name, verification: b.verification_status }));
  }, { force: force2 });
}
function mapAccount(a) {
  const status = Number(a.account_status);
  return {
    id: a.id || "act_" + a.account_id,
    accountId: String(a.account_id || String(a.id).replace(/^act_/, "")),
    name: a.name || a.account_id,
    currency: a.currency,
    timezone: a.timezone_name,
    status,
    statusLabel: ACCOUNT_STATUS[status] || "Estado " + status,
    disableReason: Number(a.disable_reason) || 0,
    businessId: a.business?.id,
    businessName: a.business?.name,
    amountSpent: toMajor(a.amount_spent, a.currency) ?? void 0,
    spendCap: Number(a.spend_cap) ? toMajor(a.spend_cap, a.currency) : void 0,
    minDailyBudget: toMajor(a.min_daily_budget, a.currency) ?? void 0
  };
}
async function adAccounts(g, force2 = false) {
  return cached("acc:list", TTL.accounts, async () => {
    const seen = /* @__PURE__ */ new Map();
    const direct = await g.all("me/adaccounts", { fields: ACCOUNT_FIELDS }, 25);
    direct.forEach((a) => seen.set(a.id, mapAccount(a)));
    const biz = (await businesses(g, force2)).value;
    await Promise.all(biz.slice(0, 25).map(async (b) => {
      for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
        try {
          const l = await g.all(`${b.id}/${edge}`, { fields: ACCOUNT_FIELDS }, 10);
          l.forEach((a) => {
            if (!seen.has(a.id)) seen.set(a.id, mapAccount({ ...a, business: a.business || { id: b.id, name: b.name } }));
          });
        } catch {
        }
      }
    }));
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name, "es"));
  }, { force: force2 });
}
async function account(g, id) {
  const a = await g.get(actId(id), { fields: ACCOUNT_FIELDS });
  return mapAccount(a);
}
function actId(id) {
  const s = String(id);
  return s.startsWith("act_") ? s : "act_" + s;
}
async function accountAssets(g, accountId, force2 = false) {
  const act = actId(accountId);
  return cached("assets:" + act, TTL.assets, async () => {
    const warnings = [];
    const soft = async (label, p, fallback) => {
      try {
        return await p;
      } catch (e) {
        warnings.push(`${label}: ${e.info?.message || e.message}${e.info?.code ? ` [${e.info.code}${e.info.subcode ? "/" + e.info.subcode : ""}]` : ""}`);
        return fallback;
      }
    };
    const acc = await soft("Cuenta", g.get(act, { fields: "business{id,name}" }), {});
    const bizId = acc?.business?.id;
    const [pagesRaw, pixelsRaw, ccRaw] = await Promise.all([
      soft("P\xE1ginas", g.all(act + "/promote_pages", { fields: "id,name,picture{url},instagram_business_account{id,username}" }, 5), []),
      soft("P\xEDxeles", g.all(act + "/adspixels", { fields: "id,name,last_fired_time,is_unavailable,creation_time,owner_business{id,name}" }, 5), []),
      soft("Conversiones personalizadas", g.all(act + "/customconversions", { fields: "id,name,custom_event_type,last_fired_time,is_archived,rule,pixel{id}" }, 5), [])
    ]);
    const activity = await Promise.all(pixelsRaw.map((p, i) => i < 15 ? pixelActivity(g, p.id, p.last_fired_time) : null));
    const pages = await Promise.all(pagesRaw.map(async (p) => {
      let whatsappNumber = null;
      try {
        const r = await g.get(p.id, { fields: "whatsapp_number" });
        whatsappNumber = r.whatsapp_number ?? "";
      } catch {
        whatsappNumber = null;
      }
      return { id: p.id, name: p.name, picture: p.picture?.data?.url, instagram: p.instagram_business_account || null, whatsappNumber };
    }));
    const wabaErrors = [];
    const { discoverWabas: discoverWabas2 } = await Promise.resolve().then(() => (init_whatsapp(), whatsapp_exports));
    const found = await discoverWabas2(g, act, wabaErrors);
    const wabas = await Promise.all(found.wabas.slice(0, 30).map(async (w) => {
      const [nums, ds] = await Promise.all([
        soft(`N\xFAmeros de "${w.name}"`, g.all(w.id + "/phone_numbers", { fields: "id,display_phone_number,verified_name,quality_rating,status,name_status,code_verification_status,platform_type,throughput" }, 3), []),
        /* Dataset de la WABA (Conversions API para mensajería): GET /{waba}/dataset. Si no hay, no es error. */
        g.get(w.id + "/dataset").then((r) => r?.data || (r?.id ? [r] : [])).catch(() => [])
      ]);
      return {
        id: w.id,
        name: w.name,
        businessId: void 0,
        business: w.business,
        relation: w.relation,
        numbers: nums.map((n2) => ({
          id: n2.id,
          display: n2.display_phone_number,
          verifiedName: n2.verified_name,
          qualityRating: n2.quality_rating,
          status: n2.status,
          nameStatus: n2.name_status,
          codeVerification: n2.code_verification_status,
          platformType: n2.platform_type,
          throughput: n2.throughput?.level,
          wabaId: w.id
        })),
        datasets: ds.map((d) => ({ id: String(d.id), name: d.name }))
      };
    }));
    if (!wabas.length && wabaErrors.length) warnings.push("WhatsApp Business: " + wabaErrors.slice(0, 3).join(" \xB7 "));
    const wabaDiscovery = { businesses: found.businesses, direct: found.direct, errors: wabaErrors };
    let catalogs = [];
    if (bizId) {
      const cats = await soft("Cat\xE1logos", g.all(bizId + "/owned_product_catalogs", { fields: "id,name,product_count,vertical" }, 5), []);
      catalogs = cats.map((c) => ({ id: c.id, name: c.name, productCount: c.product_count, vertical: c.vertical, businessId: bizId }));
    }
    return {
      pages,
      instagram: pages.filter((p) => p.instagram).map((p) => ({ id: p.instagram.id, username: p.instagram.username, pageId: p.id })),
      /* lastFiredTime es el \xFAltimo evento recibido por cualquier v\xEDa. last_fired_time de Meta solo cuenta el p\xEDxel del
         navegador: un dataset que recibe solo Conversions API (CAPI, WhatsApp, CRM, offline) lo trae vac\xEDo aunque
         reciba miles de eventos. Por eso se completa con /{pixel}/stats (eventos de los \xFAltimos 7 d\xEDas). */
      pixels: pixelsRaw.map((p, i) => {
        const a = activity[i] || {};
        return {
          id: p.id,
          name: p.name,
          lastFiredTime: a.last || p.last_fired_time || null,
          browserLastFiredTime: p.last_fired_time || null,
          events7d: a.events7d ?? null,
          topEvents: a.topEvents || [],
          activitySource: a.source || (p.last_fired_time ? "browser" : null),
          statsError: a.error,
          isUnavailable: !!p.is_unavailable,
          creationTime: p.creation_time,
          ownerBusiness: p.owner_business?.name
        };
      }),
      customConversions: ccRaw.map((c) => ({ id: c.id, name: c.name, customEventType: c.custom_event_type, pixelId: c.pixel?.id, lastFiredTime: c.last_fired_time || null, archived: !!c.is_archived, rule: c.rule })),
      wabas,
      wabaDiscovery,
      catalogs,
      warnings
    };
  }, { force: force2 });
}
async function audiences(g, accountId, force2 = false) {
  const act = actId(accountId);
  return cached("aud:" + act, TTL.audiences, async () => {
    const [custom, saved] = await Promise.all([
      g.all(act + "/customaudiences", { fields: "id,name,subtype,description,approximate_count_lower_bound,approximate_count_upper_bound,time_updated,time_created,delivery_status,operation_status,data_source,retention_days,lookalike_spec,rule,sharing_status,is_value_based" }, 10),
      g.all(act + "/saved_audiences", { fields: "id,name,description,targeting,time_updated,approximate_count_lower_bound,approximate_count_upper_bound" }, 5).catch(() => [])
    ]);
    return {
      custom: custom.map(mapAudience),
      saved: saved.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        targeting: s.targeting,
        updated: s.time_updated,
        sizeLower: s.approximate_count_lower_bound,
        sizeUpper: s.approximate_count_upper_bound
      }))
    };
  }, { force: force2 });
}
function mapAudience(a) {
  const subtype = String(a.subtype || "");
  let source = AUDIENCE_SUBTYPE[subtype] || subtype;
  const rule = typeof a.rule === "string" ? a.rule : JSON.stringify(a.rule || "");
  if (subtype === "ENGAGEMENT") {
    if (/ig_business/.test(rule)) source = "Instagram";
    else if (/"page"/.test(rule)) source = "Facebook (p\xE1gina)";
    else if (/whatsapp/i.test(rule)) source = "WhatsApp";
    else if (/lead/.test(rule)) source = "Formulario";
  }
  return {
    id: a.id,
    name: a.name,
    subtype,
    source,
    description: a.description,
    sizeLower: a.approximate_count_lower_bound ?? null,
    sizeUpper: a.approximate_count_upper_bound ?? null,
    updated: a.time_updated ? new Date(Number(a.time_updated) * 1e3).toISOString() : null,
    created: a.time_created ? new Date(Number(a.time_created) * 1e3).toISOString() : null,
    deliveryStatus: a.delivery_status?.code,
    deliveryText: a.delivery_status?.description,
    operationStatus: a.operation_status?.code,
    operationText: a.operation_status?.description,
    retentionDays: a.retention_days,
    lookalike: a.lookalike_spec || null,
    sharing: a.sharing_status?.sharing_relationship_id ? "compartido" : "propio"
  };
}
async function pixelActivity(g, pixelId, browserLast) {
  const browserMs = browserLast ? Date.parse(browserLast) : NaN;
  if (isFinite(browserMs) && Date.now() - browserMs < 864e5) return { last: browserLast, source: "browser" };
  try {
    const r = await g.get(pixelId + "/stats", { aggregation: "event", start_time: Math.floor(Date.now() / 1e3) - 7 * 86400 });
    let lastMs = 0, total = 0;
    const byEvent = /* @__PURE__ */ new Map();
    (r.data || []).forEach((b) => {
      let n2 = 0;
      (b.data || []).forEach((x) => {
        const c = Number(x.count) || 0;
        n2 += c;
        byEvent.set(x.value, (byEvent.get(x.value) || 0) + c);
      });
      total += n2;
      const t = Date.parse(b.start_time);
      if (n2 > 0 && isFinite(t) && t > lastMs) lastMs = t;
    });
    const topEvents = [...byEvent.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
    if (lastMs && (!isFinite(browserMs) || lastMs > browserMs)) return { last: new Date(lastMs).toISOString().replace(".000Z", "+0000"), events7d: total, topEvents, source: "stats" };
    return { last: browserLast || null, events7d: total, topEvents, source: browserLast ? "browser" : null };
  } catch (e) {
    return { last: browserLast || null, source: browserLast ? "browser" : null, error: e.info?.message || e.message };
  }
}
async function pixelStats(g, pixelId, force2 = false) {
  return cached("pxstats:" + pixelId, TTL.events, async () => {
    const since = Math.floor(Date.now() / 1e3) - 7 * 86400;
    const [stats, source, info] = await Promise.all([
      g.get(pixelId + "/stats", { aggregation: "event", start_time: since }).catch(() => ({ data: [] })),
      g.get(pixelId + "/stats", { aggregation: "event_source", start_time: since }).catch(() => ({ data: [] })),
      g.get(pixelId, { fields: "id,name,last_fired_time,is_unavailable,data_use_setting,first_party_cookie_status,automatic_matching_fields,enable_automatic_matching" }).catch(() => ({}))
    ]);
    const byEvent = /* @__PURE__ */ new Map();
    (stats.data || []).forEach((b) => (b.data || []).forEach((x) => {
      const cur = byEvent.get(x.value) || { count: 0, last: "" };
      const c = Number(x.count) || 0;
      cur.count += c;
      if (c > 0 && b.start_time > cur.last) cur.last = b.start_time;
      byEvent.set(x.value, cur);
    }));
    const sources = /* @__PURE__ */ new Map();
    (source.data || []).forEach((b) => (b.data || []).forEach((x) => sources.set(x.value, (sources.get(x.value) || 0) + (Number(x.count) || 0))));
    return {
      pixel: info,
      events: [...byEvent.entries()].map(([name, v2]) => ({ name, count7d: v2.count, lastReceived: v2.last })).sort((a, b) => b.count7d - a.count7d),
      sources: [...sources.entries()].map(([name, count]) => ({ name, count }))
    };
  }, { force: force2 });
}
async function datasetQuality(g, datasetId) {
  try {
    const r = await g.get("dataset_quality", { dataset_id: datasetId, fields: "web{event_name,event_match_quality,event_coverage,data_freshness,acr}" });
    const web = (r.web || []).map((x) => ({
      event: x.event_name,
      emq: x.event_match_quality?.composite_score ?? null,
      matchKeys: x.event_match_quality?.match_key_feedback || [],
      coverage: x.event_coverage || null,
      freshness: x.data_freshness?.upload_frequency || null,
      acr: x.acr || null
    }));
    return { available: true, web };
  } catch (e) {
    return { available: false, reason: e.info?.message || e.message };
  }
}
async function pageToken(g, pageId) {
  try {
    const r = await g.get(pageId, { fields: "access_token" });
    if (r.access_token) return r.access_token;
  } catch {
  }
  const l = await g.all("me/accounts", { fields: "id,access_token" }, 5).catch(() => []);
  const x = l.find((p) => String(p.id) === String(pageId));
  if (x?.access_token) return x.access_token;
  throw new Error(`No se pudo obtener el token de la p\xE1gina ${pageId}: el system user necesita la p\xE1gina asignada con permiso de anuncios y los permisos pages_manage_ads, pages_read_engagement y leads_retrieval.`);
}
var ACCOUNT_STATUS, DISABLE_REASON, TTL, ACCOUNT_FIELDS, AUDIENCE_SUBTYPE;
var init_assets = __esm({
  "server/meta/assets.ts"() {
    "use strict";
    init_currency();
    init_store();
    ACCOUNT_STATUS = {
      1: "Activa",
      2: "Deshabilitada",
      3: "Pagos pendientes",
      7: "En revisi\xF3n de riesgo",
      8: "Liquidaci\xF3n pendiente",
      9: "Periodo de gracia",
      100: "Cierre pendiente",
      101: "Cerrada",
      201: "Activa (cualquiera)",
      202: "Cerrada (cualquiera)"
    };
    DISABLE_REASON = {
      0: "",
      1: "Integridad de anuncios (pol\xEDticas)",
      2: "Revisi\xF3n de propiedad intelectual",
      3: "Riesgo de pago",
      4: "Cuenta gris cerrada",
      5: "Revisi\xF3n de AFC",
      6: "Integridad del negocio",
      7: "Cierre permanente",
      8: "Cuenta de reseller no usada",
      9: "Cuenta no usada",
      10: "Pagos recurrentes",
      11: "Compromiso de cuenta"
    };
    TTL = { accounts: 600, assets: 900, audiences: 600, events: 600, structure: 120 };
    ACCOUNT_FIELDS = "id,account_id,name,currency,timezone_name,account_status,disable_reason,amount_spent,spend_cap,min_daily_budget,business{id,name}";
    AUDIENCE_SUBTYPE = {
      CUSTOM: "Lista de clientes",
      WEBSITE: "Sitio web",
      ENGAGEMENT: "Interacci\xF3n",
      VIDEO: "Video",
      LOOKALIKE: "Similar (lookalike)",
      APP: "App",
      OFFLINE_CONVERSION: "Offline",
      CLAIM: "Reclamo de oferta",
      PARTNER: "Socio",
      MANAGED: "Administrado",
      DATA_SET: "Dataset",
      IG_BUSINESS: "Instagram",
      FB_EVENT: "Evento de Facebook",
      LEAD_AD: "Formulario",
      MESSENGER: "Messenger",
      WHATSAPP: "WhatsApp",
      SHOPPING: "Compras",
      MEASUREMENT: "Medici\xF3n",
      REGULATED_CATEGORIES_AUDIENCE: "Categor\xEDa regulada"
    };
  }
});

// server/meta/token.ts
var token_exports = {};
__export(token_exports, {
  OPTIONAL_SCOPES: () => OPTIONAL_SCOPES,
  REQUIRED_SCOPES: () => REQUIRED_SCOPES,
  activeToken: () => activeToken,
  deleteConnection: () => deleteConnection,
  graph: () => graph,
  listConnections: () => listConnections,
  resetGraphCache: () => resetGraphCache,
  saveConnection: () => saveConnection,
  setDefaultConnection: () => setDefaultConnection,
  tokenHealth: () => tokenHealth
});
async function listConnections() {
  const keys = await kv("core").list("metaconn/");
  return (await Promise.all(keys.map((k) => kv("core").get(k)))).filter(Boolean);
}
async function saveConnection(p) {
  const conns = await listConnections();
  const c = { ...p, id: p.id || randomId(8), tokenEnc: await encrypt(p.token), createdAt: (/* @__PURE__ */ new Date()).toISOString() };
  delete c.token;
  if (c.isDefault) {
    for (const o of conns) if (o.isDefault && o.id !== c.id) {
      o.isDefault = false;
      await kv("core").set("metaconn/" + o.id, o);
    }
  }
  await kv("core").set("metaconn/" + c.id, c);
  return c;
}
async function deleteConnection(id) {
  await kv("core").del("metaconn/" + id);
}
async function setDefaultConnection(id) {
  for (const c of await listConnections()) {
    const d = c.id === id;
    if (c.isDefault !== d) {
      c.isDefault = d;
      await kv("core").set("metaconn/" + c.id, c);
    }
  }
}
async function activeToken() {
  if (env.metaMode === "mock") return { token: "mock-token", source: "mock", label: "API simulada (desarrollo)" };
  const def = (await listConnections()).find((c) => c.isDefault);
  if (def) {
    try {
      return { token: await decrypt(def.tokenEnc), source: "connection", connectionId: def.id, label: def.label };
    } catch {
    }
  }
  if (env.metaToken) return { token: env.metaToken, source: "env", label: "System user (META_ACCESS_TOKEN)" };
  throw new MetaApiError({
    endpoint: "-",
    method: "-",
    message: "No hay token de Meta configurado.",
    category: "token_invalid",
    cause: "Falta META_ACCESS_TOKEN y no hay una conexi\xF3n de Meta predeterminada.",
    recommendation: "Configura META_ACCESS_TOKEN en Netlify o conecta Meta desde Conexi\xF3n con Meta.",
    retryable: false
  });
}
async function graph() {
  const t = await activeToken();
  const key2 = t.source + ":" + (t.connectionId || "") + ":" + t.token.slice(-8);
  if (graphCache?.key === key2) return graphCache.g;
  graphCache = { key: key2, g: new Graph(t.token, { label: t.label }) };
  return graphCache.g;
}
function resetGraphCache() {
  graphCache = null;
}
async function tokenHealth() {
  const checks = [];
  const add3 = (c) => checks.push(c);
  let t;
  try {
    t = await activeToken();
  } catch (e) {
    add3({ group: "Token", item: "Token configurado", status: "error", detail: e.info?.cause || e.message, fix: e.info?.recommendation });
    return { source: "env", label: "\u2014", checks, scopes: [], checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const g = new Graph(t.token, { label: t.label });
  const vnum = Number(env.metaVersion.replace(/^v/, "").split(".")[0]) || 0;
  add3({
    group: "API",
    item: "Versi\xF3n de la API",
    status: vnum < API_MIN ? "error" : vnum < API_TARGET ? "warning" : "ok",
    detail: `META_API_VERSION = ${env.metaVersion}.` + (vnum < API_MIN ? " Meta ya retir\xF3 esta versi\xF3n." : vnum < API_TARGET ? ` Funciona, pero la versi\xF3n vigente es v${API_TARGET}.0.` : ""),
    fix: vnum < API_TARGET ? `Cambia META_API_VERSION a v${API_TARGET}.0 en Netlify (y en n8n) y vuelve a publicar. Desde v26.0 Meta exige is_adset_budget_sharing_enabled en campa\xF1as sin presupuesto de campa\xF1a y retir\xF3 GET /?ids= y las ubicaciones Explorar de Instagram e Historias de Messenger; la plataforma ya lo contempla.` : void 0
  });
  add3({
    group: "API",
    item: "appsecret_proof",
    status: env.metaAppSecret ? "ok" : "warning",
    detail: env.metaAppSecret ? "Las llamadas van firmadas con appsecret_proof." : "Sin META_APP_SECRET: no se firma con appsecret_proof ni se puede leer debug_token con token de app.",
    fix: env.metaAppSecret ? void 0 : 'Configura META_APP_ID y META_APP_SECRET y activa "Require App Secret" en la app de Meta.'
  });
  const [me, perms, dbg] = await Promise.all([
    g.get("me", { fields: "id,name" }).catch((e) => ({ __err: e })),
    g.all("me/permissions").catch((e) => ({ __err: e })),
    /* debug_token se consulta con el token de la app (id|secret) si está configurada; si no, con el propio token. */
    (env.metaAppId && env.metaAppSecret ? new Graph(env.metaAppId + "|" + env.metaAppSecret, { label: "app" }) : g).get("debug_token", { input_token: t.token }).catch((e) => ({ __err: e }))
  ]);
  if (me.__err) {
    const e = me.__err;
    add3({ group: "Token", item: "Validez", status: "error", detail: `${e.info?.message} [${e.info?.code}${e.info?.subcode ? "/" + e.info.subcode : ""}]`, fix: e.info?.recommendation, meta: e.info });
    return { source: t.source, label: t.label, checks, scopes: [], checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  add3({ group: "Token", item: "Validez", status: "ok", detail: `Token v\xE1lido de "${me.name}" (${me.id}).` });
  const d = dbg.__err ? null : dbg.data;
  let tokenType, expiresAt;
  if (d) {
    tokenType = d.type;
    expiresAt = Number(d.expires_at) ? Number(d.expires_at) * 1e3 : null;
    const days = expiresAt ? (expiresAt - Date.now()) / 864e5 : null;
    add3({
      group: "Token",
      item: "Tipo y vencimiento",
      status: d.is_valid === false ? "error" : days !== null && days < 7 ? "error" : days !== null && days < 20 ? "warning" : "ok",
      detail: `${d.type === "SYSTEM_USER" ? "System user" : "Token de " + (d.type || "tipo desconocido")}${expiresAt ? ", vence el " + new Date(expiresAt).toISOString().slice(0, 10) + ` (${Math.max(0, Math.floor(days))} d\xEDas)` : ", no vence"}.`,
      fix: d.type !== "SYSTEM_USER" ? "Para una agencia conviene un token de system user (no vence ni depende de una persona). Si usas Facebook Login, la herramienta avisar\xE1 antes del vencimiento." : void 0
    });
    if (Number(d.data_access_expires_at)) {
      const da = Number(d.data_access_expires_at) * 1e3;
      const dd = (da - Date.now()) / 864e5;
      add3({ group: "Token", item: "Acceso a datos", status: dd < 7 ? "error" : dd < 20 ? "warning" : "ok", detail: `El acceso a datos vence el ${new Date(da).toISOString().slice(0, 10)}.`, fix: dd < 20 ? "Reconecta Meta para renovar el acceso a datos (90 d\xEDas)." : void 0 });
    }
  } else add3({ group: "Token", item: "Tipo y vencimiento", status: "info", detail: "No se pudo leer debug_token (configura META_APP_ID/META_APP_SECRET para verlo)." });
  const granted = perms.__err ? [] : perms.filter((p) => p.status === "granted").map((p) => p.permission);
  const scopes = granted.length ? granted : d?.scopes || [];
  const missing = Object.keys(REQUIRED_SCOPES).filter((s) => !scopes.includes(s));
  add3({
    group: "Permisos",
    item: "Permisos necesarios",
    status: missing.length ? "error" : "ok",
    detail: missing.length ? "Faltan: " + missing.map((s) => `${s} (${REQUIRED_SCOPES[s]})`).join(", ") + "." : `Tiene los ${Object.keys(REQUIRED_SCOPES).length} permisos que usa la plataforma.`,
    fix: missing.length ? "Regenera el token del system user marcando esos permisos (Business Manager \u2192 Usuarios del sistema \u2192 Generar token)." : void 0
  });
  const opt = Object.keys(OPTIONAL_SCOPES).filter((s) => !scopes.includes(s));
  if (opt.length) add3({ group: "Permisos", item: "Permisos opcionales", status: "info", detail: "Sin " + opt.map((s) => `${s} (${OPTIONAL_SCOPES[s]})`).join(", ") + "." });
  const declined = perms.__err ? [] : perms.filter((p) => p.status === "declined").map((p) => p.permission);
  if (declined.length) add3({ group: "Permisos", item: "Permisos rechazados", status: "warning", detail: "El usuario rechaz\xF3: " + declined.join(", ") + ".", fix: "Vuelve a conectar y acepta todos los permisos." });
  return { source: t.source, label: t.label, checks, scopes, tokenType, expiresAt, user: me, checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
var REQUIRED_SCOPES, OPTIONAL_SCOPES, graphCache;
var init_token = __esm({
  "server/meta/token.ts"() {
    "use strict";
    init_env();
    init_crypto();
    init_store();
    init_client();
    init_errors();
    REQUIRED_SCOPES = {
      ads_management: "crear y editar campa\xF1as, conjuntos y anuncios",
      ads_read: "leer campa\xF1as y m\xE9tricas",
      business_management: "leer Business Manager, portafolios y activos",
      pages_show_list: "listar p\xE1ginas",
      pages_read_engagement: "leer p\xE1ginas, Instagram vinculado y token de p\xE1gina",
      pages_manage_ads: "anuncios y formularios de la p\xE1gina",
      leads_retrieval: "formularios instant\xE1neos y descarga de leads",
      whatsapp_business_management: "cuentas y n\xFAmeros de WhatsApp Business, datasets de WhatsApp"
    };
    OPTIONAL_SCOPES = {
      read_insights: "m\xE9tricas de p\xE1gina e Instagram",
      instagram_basic: "cuentas y publicaciones de Instagram",
      pages_read_user_content: "publicaciones existentes como anuncio",
      catalog_management: "cat\xE1logos de productos"
    };
    graphCache = null;
  }
});

// server/meta/entities.ts
var entities_exports = {};
__export(entities_exports, {
  ADSET_FIELDS: () => ADSET_FIELDS,
  AD_FIELDS: () => AD_FIELDS,
  CAMPAIGN_FIELDS: () => CAMPAIGN_FIELDS,
  CREATIVE_FIELDS: () => CREATIVE_FIELDS,
  cloneCreativeWithChanges: () => cloneCreativeWithChanges,
  copyEntity: () => copyEntity,
  deleteEntity: () => deleteEntity,
  invalidateAccount: () => invalidateAccount,
  mapAd: () => mapAd,
  mapAdset: () => mapAdset,
  mapCampaign: () => mapCampaign,
  mapCreative: () => mapCreative,
  statusFromEffective: () => statusFromEffective,
  structure: () => structure,
  updateEntity: () => updateEntity,
  updatePayload: () => updatePayload
});
function mapCampaign(c, accountId, currency) {
  return {
    id: c.id,
    accountId: actId(accountId),
    name: c.name,
    objective: c.objective,
    status: c.status,
    effectiveStatus: c.effective_status,
    buyingType: c.buying_type,
    dailyBudget: toMajor(c.daily_budget, currency),
    lifetimeBudget: toMajor(c.lifetime_budget, currency),
    bidStrategy: c.bid_strategy,
    specialAdCategories: c.special_ad_categories,
    startTime: c.start_time,
    stopTime: c.stop_time,
    budgetSharing: c.is_adset_budget_sharing_enabled,
    issues: issues(c),
    createdTime: c.created_time,
    updatedTime: c.updated_time
  };
}
function mapAdset(a, accountId, currency) {
  return {
    id: a.id,
    accountId: actId(accountId),
    campaignId: a.campaign_id,
    name: a.name,
    status: a.status,
    effectiveStatus: a.effective_status,
    dailyBudget: toMajor(a.daily_budget, currency),
    lifetimeBudget: toMajor(a.lifetime_budget, currency),
    bidAmount: toMajor(a.bid_amount, currency),
    bidStrategy: a.bid_strategy,
    billingEvent: a.billing_event,
    optimizationGoal: a.optimization_goal,
    destinationType: a.destination_type,
    promotedObject: a.promoted_object,
    targeting: a.targeting,
    startTime: a.start_time,
    endTime: a.end_time,
    attributionSpec: a.attribution_spec,
    learningStage: a.learning_stage_info?.status,
    issues: issues(a),
    createdTime: a.created_time,
    updatedTime: a.updated_time
  };
}
function mapCreative(c) {
  if (!c) return void 0;
  const oss = c.object_story_spec || {};
  const ld = oss.link_data || {}, vd = oss.video_data || {};
  const afs = c.asset_feed_spec || {};
  const cta = ld.call_to_action || vd.call_to_action || {};
  return {
    id: c.id,
    name: c.name,
    body: ld.message || vd.message || afs.bodies?.[0]?.text || c.body || "",
    title: ld.name || vd.title || afs.titles?.[0]?.text || c.title || "",
    description: ld.description || vd.link_description || afs.descriptions?.[0]?.text || "",
    link: cta.value?.link || ld.link || afs.link_urls?.[0]?.website_url || c.link_url || "",
    cta: cta.type || c.call_to_action_type || afs.call_to_action_types?.[0] || "",
    urlTags: c.url_tags || "",
    imageHash: ld.image_hash || c.image_hash,
    imageUrl: c.image_url || ld.picture,
    videoId: vd.video_id || c.video_id,
    thumbnailUrl: c.thumbnail_url,
    leadFormId: cta.value?.lead_gen_form_id,
    pageId: oss.page_id,
    instagramUserId: oss.instagram_user_id,
    objectStorySpec: c.object_story_spec,
    assetFeedSpec: c.asset_feed_spec,
    effectiveObjectStoryId: c.effective_object_story_id
  };
}
function mapAd(a, accountId) {
  return {
    id: a.id,
    accountId: actId(accountId),
    campaignId: a.campaign_id,
    adsetId: a.adset_id,
    name: a.name,
    status: a.status,
    effectiveStatus: a.effective_status,
    creativeId: a.creative?.id,
    creative: mapCreative(a.creative),
    reviewFeedback: a.ad_review_feedback,
    issues: issues(a),
    createdTime: a.created_time,
    updatedTime: a.updated_time
  };
}
async function structure(g, accountId, currency, o = {}) {
  const act = actId(accountId);
  const statuses = o.statuses?.length ? o.statuses : DEFAULT_STATUSES;
  const key2 = `struct:${act}:${statuses.slice().sort().join(",")}`;
  return cached(key2, 120, async () => {
    const filtering = [{ field: "effective_status", operator: "IN", value: statuses }];
    const [cs, as, ads] = await Promise.all([
      g.all(act + "/campaigns", { fields: CAMPAIGN_FIELDS, filtering, limit: 200 }, 25),
      g.all(act + "/adsets", { fields: ADSET_FIELDS, filtering: [{ field: "effective_status", operator: "IN", value: [...statuses, "CAMPAIGN_PAUSED"] }], limit: 200 }, 50),
      g.all(act + "/ads", { fields: AD_FIELDS, filtering: [{ field: "effective_status", operator: "IN", value: [...statuses, "CAMPAIGN_PAUSED", "ADSET_PAUSED"] }], limit: 100 }, 100)
    ]);
    return {
      campaigns: cs.map((c) => mapCampaign(c, act, currency)),
      adsets: as.map((a) => mapAdset(a, act, currency)),
      ads: ads.map((a) => mapAd(a, act))
    };
  }, { force: o.force });
}
async function invalidateAccount(accountId) {
  const act = actId(accountId);
  await Promise.all([invalidate("struct:" + act), invalidate("ins:" + act)]);
}
function updatePayload(level, fields, currency) {
  const p = {};
  for (const [k, { after }] of Object.entries(fields)) {
    if (k.startsWith("creative.")) continue;
    switch (k) {
      case "daily_budget":
      case "lifetime_budget":
      case "bid_amount":
      case "spend_cap":
        p[k] = toMinor(after, currency);
        break;
      case "status":
      case "name":
      case "end_time":
      case "start_time":
      case "stop_time":
      case "bid_strategy":
      case "optimization_goal":
      case "billing_event":
      case "targeting":
      case "promoted_object":
      case "attribution_spec":
      case "special_ad_categories":
        p[k] = after;
        break;
      default:
        throw new Error(`El campo "${k}" no se puede editar en ${level}.`);
    }
  }
  return p;
}
async function cloneCreativeWithChanges(g, accountId, creativeId, fields) {
  const c = await g.get(creativeId, { fields: CREATIVE_FIELDS });
  const get = (k) => fields["creative." + k]?.after;
  const has = (k) => "creative." + k in fields;
  const payload = { name: (c.name || "Creativo") + " \xB7 ed " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ") };
  if (has("url_tags")) payload.url_tags = get("url_tags");
  else if (c.url_tags) payload.url_tags = c.url_tags;
  if (c.degrees_of_freedom_spec) payload.degrees_of_freedom_spec = c.degrees_of_freedom_spec;
  const onlyTags = Object.keys(fields).every((k) => k === "creative.url_tags");
  if (!c.object_story_spec && (c.object_story_id || c.effective_object_story_id)) {
    if (!onlyTags) throw new Error("El anuncio usa una publicaci\xF3n existente: solo se pueden cambiar los par\xE1metros de URL (UTM), no el texto ni el bot\xF3n.");
    payload.object_story_id = c.object_story_id || c.effective_object_story_id;
  } else {
    const oss = JSON.parse(JSON.stringify(c.object_story_spec || {}));
    const afs = c.asset_feed_spec ? JSON.parse(JSON.stringify(c.asset_feed_spec)) : null;
    const ld = oss.link_data, vd = oss.video_data;
    if (ld) {
      if (has("body")) ld.message = get("body");
      if (has("title")) ld.name = get("title");
      if (has("description")) ld.description = get("description");
      if (has("link")) {
        ld.link = get("link");
        if (ld.call_to_action?.value?.link) ld.call_to_action.value.link = get("link");
      }
      if (has("cta")) ld.call_to_action = { ...ld.call_to_action || {}, type: get("cta"), value: { ...ld.call_to_action?.value || {}, ...ld.call_to_action?.value?.link || !ld.link ? {} : { link: ld.link } } };
      delete ld.picture_hash;
    }
    if (vd) {
      if (has("body")) vd.message = get("body");
      if (has("title")) vd.title = get("title");
      if (has("description")) vd.link_description = get("description");
      if (has("link") && vd.call_to_action) vd.call_to_action.value = { ...vd.call_to_action.value || {}, link: get("link") };
      if (has("cta")) vd.call_to_action = { ...vd.call_to_action || {}, type: get("cta") };
      if (vd.image_hash && vd.image_url) delete vd.image_url;
    }
    if (afs) {
      if (has("body")) afs.bodies = [{ text: get("body") }, ...(afs.bodies || []).slice(1)];
      if (has("title")) afs.titles = [{ text: get("title") }, ...(afs.titles || []).slice(1)];
      if (has("description")) afs.descriptions = [{ text: get("description") }, ...(afs.descriptions || []).slice(1)];
      if (has("link")) afs.link_urls = (afs.link_urls || [{}]).map((l) => ({ ...l, website_url: get("link") }));
      if (has("cta")) afs.call_to_action_types = [get("cta")];
      payload.asset_feed_spec = afs;
    }
    payload.object_story_spec = oss;
  }
  const r = await g.post(actId(accountId) + "/adcreatives", payload);
  return r.id;
}
async function updateEntity(g, level, id, accountId, currency, fields) {
  const creativeKeys = Object.keys(fields).filter((k) => k.startsWith("creative."));
  const p = updatePayload(level, fields, currency);
  if (level === "ad" && creativeKeys.length) {
    const ad = await g.get(id, { fields: "creative{id}" });
    const creativeId = await cloneCreativeWithChanges(g, accountId, ad.creative.id, Object.fromEntries(creativeKeys.map((k) => [k, fields[k]])));
    p.creative = { creative_id: creativeId };
  }
  if (!Object.keys(p).length) return { id, updated: false };
  await g.post(id, p);
  return { id, updated: true, payload: p };
}
async function deleteEntity(g, id) {
  return g.del(id);
}
async function copyEntity(g, level, id, o) {
  const p = { status_option: o.statusOption || "PAUSED" };
  if (level !== "ad") p.deep_copy = !!o.deep;
  if (o.renameSuffix) p.rename_options = { rename_suffix: o.renameSuffix };
  if (level === "adset" && o.targetParentId) p.campaign_id = o.targetParentId;
  if (level === "ad" && o.targetParentId) p.adset_id = o.targetParentId;
  const r = await g.post(id + "/copies", p);
  return { id: r.copied_campaign_id || r.copied_adset_id || r.copied_ad_id || r.id, raw: r };
}
function statusFromEffective(s) {
  if (["ACTIVE"].includes(s)) return "ok";
  if (["WITH_ISSUES", "DISAPPROVED", "PENDING_BILLING_INFO"].includes(s)) return "err";
  if (["IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED"].includes(s)) return "warn";
  return "off";
}
var CAMPAIGN_FIELDS, ADSET_FIELDS, CREATIVE_FIELDS, AD_FIELDS, issues, DEFAULT_STATUSES;
var init_entities = __esm({
  "server/meta/entities.ts"() {
    "use strict";
    init_currency();
    init_store();
    init_assets();
    CAMPAIGN_FIELDS = "id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,start_time,stop_time,is_adset_budget_sharing_enabled,issues_info,created_time,updated_time,spend_cap";
    ADSET_FIELDS = "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,bid_amount,bid_strategy,billing_event,optimization_goal,destination_type,promoted_object,targeting,start_time,end_time,attribution_spec,learning_stage_info,issues_info,created_time,updated_time";
    CREATIVE_FIELDS = "id,name,object_story_spec,asset_feed_spec,url_tags,thumbnail_url,image_url,image_hash,video_id,call_to_action_type,effective_object_story_id,object_story_id,degrees_of_freedom_spec,body,title,link_url";
    AD_FIELDS = `id,name,adset_id,campaign_id,status,effective_status,ad_review_feedback,issues_info,created_time,updated_time,creative{${CREATIVE_FIELDS}}`;
    issues = (x) => x?.issues_info?.length ? x.issues_info.map((i) => i.error_summary || i.error_message || String(i.error_code)) : void 0;
    DEFAULT_STATUSES = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"];
  }
});

// shared/roles.ts
var PERMISSIONS = [
  "read",
  /* ver cuentas, campañas, métricas */
  "edit",
  /* preparar cambios en el editor */
  "publish",
  /* publicar cambios en Meta */
  "publish_budget_increase",
  /* subir presupuestos por encima del umbral */
  "create",
  /* crear campañas, conjuntos, anuncios */
  "delete",
  /* eliminar o archivar */
  "audiences",
  /* crear o editar públicos */
  "rules",
  /* crear y editar reglas */
  "rules_execute",
  /* permitir que una regla ejecute acciones */
  "templates",
  /* plantillas de UTM a nivel empresa */
  "plan",
  /* plan masivo (motor n8n) */
  "meta_connect",
  /* conectar tokens de Meta */
  "users",
  /* administrar usuarios y roles */
  "audit"
  /* ver el registro de actividad completo */
];
var ROLE_ORDER = ["admin", "director", "coordinador", "analista", "lectura"];
var ROLE_PERMISSIONS = {
  admin: [...PERMISSIONS],
  director: ["read", "edit", "publish", "publish_budget_increase", "create", "delete", "audiences", "rules", "rules_execute", "templates", "plan", "audit"],
  coordinador: ["read", "edit", "publish", "create", "delete", "audiences", "rules", "templates", "plan", "audit"],
  analista: ["read", "edit", "create", "audiences", "rules"],
  lectura: ["read"]
};

// server/lib/http.ts
var ApiError = class extends Error {
  constructor(status, message2, code = "error", details) {
    super(message2);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  status;
  code;
  details;
};
var Router = class {
  routes = [];
  add(method, path2, handler, opts = {}) {
    const keys = [];
    const re = new RegExp("^" + path2.replace(/:([a-zA-Z_]+)/g, (_, k) => {
      keys.push(k);
      return "([^/]+)";
    }) + "/?$");
    this.routes.push({ method, re, keys, handler, opts: { auth: true, ...opts } });
  }
  get(p, h, o) {
    this.add("GET", p, h, o);
  }
  post(p, h, o) {
    this.add("POST", p, h, o);
  }
  put(p, h, o) {
    this.add("PUT", p, h, o);
  }
  del(p, h, o) {
    this.add("DELETE", p, h, o);
  }
  match(method, path2) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = path2.match(r.re);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
};
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  cookies.forEach((c) => h.append("Set-Cookie", c));
  return new Response(null, { status: 302, headers: h });
}
function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function cookie(name, value, opts = {}) {
  const secure = !(process.env.NETLIFY === void 0 && process.env.NODE_ENV !== "production");
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || "/"}`, `SameSite=${opts.sameSite || "Lax"}`];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (opts.maxAge !== void 0) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}
function clientIp(req) {
  return req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "";
}

// server/auth/session.ts
init_crypto();
init_store();

// server/auth/users.ts
init_env();
init_store();
var key = (email) => "user/" + email.toLowerCase();
async function getUser(email) {
  return kv("core").get(key(email));
}
async function saveUser(u) {
  await kv("core").set(key(u.email), u);
}
async function listUsers() {
  const keys = await kv("core").list("user/");
  return (await Promise.all(keys.map((k) => kv("core").get(k)))).filter(Boolean);
}
async function upsertOnLogin(p) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await getUser(p.email);
  if (existing) {
    const u2 = { ...existing, name: p.name || existing.name, picture: p.picture, lastLoginAt: now, loginCount: (existing.loginCount || 0) + 1 };
    if (env.adminEmails.includes(p.email.toLowerCase()) && u2.role !== "admin") u2.role = "admin";
    await saveUser(u2);
    return u2;
  }
  const isFirst = (await kv("core").list("user/")).length === 0;
  const role = env.adminEmails.includes(p.email.toLowerCase()) || isFirst ? "admin" : "analista";
  const u = { email: p.email.toLowerCase(), name: p.name, picture: p.picture, role, domain: p.domain, active: true, createdAt: now, lastLoginAt: now, loginCount: 1 };
  await saveUser(u);
  return u;
}

// server/auth/session.ts
var SESSION_COOKIE = "pmos_session";
var IDLE_MS = 12 * 3600 * 1e3;
var ABSOLUTE_MS = 7 * 24 * 3600 * 1e3;
var REFRESH_MS = 15 * 60 * 1e3;
async function createSession(email, ip, ua) {
  const now = Date.now();
  const record = { id: randomId(24), email: email.toLowerCase(), createdAt: now, lastSeenAt: now, expiresAt: now + ABSOLUTE_MS, ip, ua: ua.slice(0, 200) };
  await kv("core").set("session/" + record.id, record);
  return { record, cookie: await sessionCookie(record) };
}
async function sessionCookie(r) {
  const token = await sign({ sid: r.id, iat: Date.now() });
  return cookie(SESSION_COOKIE, token, { maxAge: Math.floor(IDLE_MS / 1e3) });
}
function clearSessionCookie() {
  return cookie(SESSION_COOKIE, "", { maxAge: 0 });
}
async function readSession(req) {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const payload = await verify(token).catch(() => null);
  if (!payload?.sid) return null;
  const record = await kv("core").get("session/" + payload.sid);
  const now = Date.now();
  if (!record || record.revoked || record.expiresAt < now || now - record.lastSeenAt > IDLE_MS) return null;
  const u = await getUser(record.email);
  if (!u || !u.active) return null;
  let refreshCookie;
  if (now - record.lastSeenAt > REFRESH_MS) {
    record.lastSeenAt = now;
    await kv("core").set("session/" + record.id, record);
    refreshCookie = await sessionCookie(record);
  }
  return {
    record,
    refreshCookie,
    user: { email: u.email, name: u.name, picture: u.picture, role: u.role, domain: u.domain, lastLoginAt: u.lastLoginAt, permissions: ROLE_PERMISSIONS[u.role] }
  };
}
async function revokeSession(id) {
  const r = await kv("core").get("session/" + id);
  if (r) {
    r.revoked = true;
    await kv("core").set("session/" + id, r);
  }
}
async function revokeUserSessions(email) {
  const keys = await kv("core").list("session/");
  for (const k of keys) {
    const r = await kv("core").get(k);
    if (r && r.email === email.toLowerCase() && !r.revoked) {
      r.revoked = true;
      await kv("core").set(k, r);
    }
  }
}

// server/api.ts
init_env();
init_errors();
init_client();

// shared/meta/objectives.ts
var LEAD_EVENTS = ["LEAD", "COMPLETE_REGISTRATION", "CONTACT", "SUBMIT_APPLICATION", "SCHEDULE"];
var WEBSITE_EVENTS = [
  "PURCHASE",
  "LEAD",
  "COMPLETE_REGISTRATION",
  "CONTACT",
  "INITIATED_CHECKOUT",
  "ADD_TO_CART",
  "ADD_PAYMENT_INFO",
  "ADD_TO_WISHLIST",
  "CONTENT_VIEW",
  "SEARCH",
  "SUBSCRIBE",
  "START_TRIAL",
  "SUBMIT_APPLICATION",
  "SCHEDULE",
  "FIND_LOCATION",
  "CUSTOMIZE_PRODUCT",
  "DONATE",
  "OTHER"
];
var WEBSITE_CTAS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "GET_OFFER", "GET_QUOTE", "CONTACT_US", "APPLY_NOW", "BOOK_TRAVEL", "DOWNLOAD", "ORDER_NOW", "SEE_MORE", "BUY_NOW", "NO_BUTTON"];
var LEAD_CTAS = ["SIGN_UP", "LEARN_MORE", "SUBSCRIBE", "GET_QUOTE", "APPLY_NOW", "DOWNLOAD", "GET_OFFER", "BOOK_TRAVEL", "CONTACT_US"];
var WA_CTAS = ["WHATSAPP_MESSAGE"];
var MSG_CTAS = ["MESSAGE_PAGE"];
var IG_CTAS = ["INSTAGRAM_MESSAGE"];
var CALL_CTAS = ["CALL_NOW"];
var G = {
  reach: { goal: "REACH", label: "Alcance", help: "Mostrar el anuncio al mayor n\xFAmero de personas.", billing: ["IMPRESSIONS"], requires: [] },
  impressions: { goal: "IMPRESSIONS", label: "Impresiones", help: "Mostrar el anuncio el mayor n\xFAmero de veces.", billing: ["IMPRESSIONS"], requires: [] },
  recall: { goal: "AD_RECALL_LIFT", label: "Recordaci\xF3n del anuncio", help: "Personas que probablemente recuerden el anuncio.", billing: ["IMPRESSIONS"], requires: [] },
  thruplay: { goal: "THRUPLAY", label: "ThruPlay", help: "Reproducciones de 15 s o completas.", billing: ["IMPRESSIONS", "THRUPLAY"], requires: ["video"] },
  video2s: { goal: "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS", label: "Reproducciones de 2 s continuos", help: "Reproducciones de al menos 2 s.", billing: ["IMPRESSIONS"], requires: ["video"] },
  clicks: { goal: "LINK_CLICKS", label: "Clics en el enlace", help: "Personas con m\xE1s probabilidad de hacer clic.", billing: ["IMPRESSIONS", "LINK_CLICKS"], requires: [] },
  lpv: { goal: "LANDING_PAGE_VIEWS", label: "Visitas a la p\xE1gina de destino", help: "Clics que cargan la p\xE1gina (requiere p\xEDxel en el sitio).", billing: ["IMPRESSIONS"], requires: ["url"] },
  conversations: { goal: "CONVERSATIONS", label: "Conversaciones", help: "Maximiza las conversaciones iniciadas.", billing: ["IMPRESSIONS"], requires: ["page"] },
  engagement: { goal: "POST_ENGAGEMENT", label: "Interacci\xF3n con la publicaci\xF3n", help: "Reacciones, comentarios y compartidos.", billing: ["IMPRESSIONS"], requires: ["page"] },
  likes: { goal: "PAGE_LIKES", label: "Me gusta de la p\xE1gina", help: "Seguidores de la p\xE1gina.", billing: ["IMPRESSIONS"], requires: ["page"] },
  webConv: (events) => ({ goal: "OFFSITE_CONVERSIONS", label: "Conversiones", help: "Optimiza por un evento del p\xEDxel / conjunto de datos.", billing: ["IMPRESSIONS"], requires: ["pixel", "conversionEvent", "url"], events }),
  value: { goal: "VALUE", label: "Valor de las conversiones", help: "Maximiza el valor de compra (requiere valor en el evento).", billing: ["IMPRESSIONS"], requires: ["pixel", "conversionEvent", "url"], events: ["PURCHASE"], roas: true },
  leadForm: { goal: "LEAD_GENERATION", label: "Clientes potenciales", help: "Maximiza formularios enviados.", billing: ["IMPRESSIONS"], requires: ["page", "leadForm"] },
  qualityLead: { goal: "QUALITY_LEAD", label: "Clientes potenciales de calidad (conversion leads)", help: "Optimiza por leads que avanzan en tu CRM (requiere CAPI para CRM integrada).", billing: ["IMPRESSIONS"], requires: ["page", "leadForm"], verify: "Requiere que el conjunto de datos reciba eventos del embudo del CRM (Conversions API for CRM)." },
  calls: { goal: "QUALITY_CALL", label: "Llamadas", help: "Maximiza llamadas de al menos 20 s.", billing: ["IMPRESSIONS"], requires: ["page", "phoneNumber"] }
};
var OBJECTIVES = [
  {
    key: "OUTCOME_AWARENESS",
    label: "Reconocimiento",
    short: "Awareness",
    help: "Mostrar anuncios a las personas con m\xE1s probabilidad de recordarlos.",
    destinations: [
      {
        key: "NONE",
        label: "Sin destino espec\xEDfico",
        help: "Anuncios de alcance, impresiones, recordaci\xF3n o video.",
        ctas: WEBSITE_CTAS,
        goals: [G.reach, G.impressions, G.recall, G.thruplay, G.video2s]
      }
    ]
  },
  {
    key: "OUTCOME_TRAFFIC",
    label: "Tr\xE1fico",
    short: "Traffic",
    help: "Enviar personas a un destino: sitio web, app, WhatsApp, Messenger o llamadas.",
    destinations: [
      {
        key: "WEBSITE",
        label: "Sitio web",
        destinationType: "WEBSITE",
        help: "Clics o visitas a la p\xE1gina de destino.",
        ctas: WEBSITE_CTAS,
        goals: [G.lpv, G.clicks, G.impressions, G.reach]
      },
      {
        key: "WHATSAPP",
        label: "WhatsApp",
        destinationType: "WHATSAPP",
        help: "Clic a WhatsApp optimizando por clics.",
        ctas: WA_CTAS,
        goals: [G.clicks, { ...G.conversations, verify: "Meta admite Conversaciones con Tr\xE1fico en algunas cuentas." }]
      },
      { key: "MESSENGER", label: "Messenger", destinationType: "MESSENGER", help: "Clic a Messenger.", ctas: MSG_CTAS, goals: [G.clicks] },
      {
        key: "CALLS",
        label: "Llamadas",
        destinationType: "PHONE_CALL",
        help: "Clics en el bot\xF3n de llamada.",
        ctas: CALL_CTAS,
        goals: [{ ...G.clicks, requires: ["phoneNumber"] }]
      }
    ]
  },
  {
    key: "OUTCOME_ENGAGEMENT",
    label: "Interacci\xF3n",
    short: "Engagement",
    help: "Mensajes, interacci\xF3n con publicaciones, reproducciones, seguidores o llamadas.",
    destinations: [
      {
        key: "WHATSAPP",
        label: "WhatsApp",
        destinationType: "WHATSAPP",
        help: "Click to WhatsApp: el anuncio abre una conversaci\xF3n con tu n\xFAmero.",
        ctas: WA_CTAS,
        goals: [
          G.conversations,
          G.clicks,
          {
            goal: "MESSAGING_PURCHASE_CONVERSION",
            label: "Compras por mensajes",
            billing: ["IMPRESSIONS"],
            requires: ["page", "whatsappDataset"],
            help: "Optimiza por compras reportadas desde WhatsApp con la Conversions API for Business Messaging.",
            verify: "Meta la habilita por cuenta y puede rechazarla con Interacci\xF3n (2490408). Se comprueba con Meta antes de crear; si no la acepta, se ofrece la alternativa que s\xED acepte tu cuenta (normalmente Ventas + Conversiones con el dataset de WhatsApp)."
          }
        ]
      },
      { key: "MESSENGER", label: "Messenger", destinationType: "MESSENGER", help: "Conversaciones en Messenger.", ctas: MSG_CTAS, goals: [G.conversations, G.clicks] },
      { key: "INSTAGRAM_DIRECT", label: "Instagram Direct", destinationType: "INSTAGRAM_DIRECT", help: "Conversaciones por mensaje directo de Instagram.", ctas: IG_CTAS, goals: [G.conversations, G.clicks] },
      { key: "MESSAGING_APPS", label: "Varias apps de mensajes", destinationType: "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP", help: "Meta env\xEDa a la app de mensajes con m\xE1s probabilidad de respuesta.", ctas: MSG_CTAS, goals: [G.conversations] },
      {
        key: "ON_AD",
        label: "En el anuncio",
        destinationType: "ON_POST",
        help: "Interacci\xF3n con la publicaci\xF3n o reproducciones de video.",
        ctas: WEBSITE_CTAS,
        goals: [G.engagement, G.thruplay, G.video2s, G.impressions, G.reach]
      },
      { key: "ON_PAGE", label: "Tu p\xE1gina", destinationType: "ON_PAGE", help: "Seguidores de la p\xE1gina.", ctas: WEBSITE_CTAS, goals: [G.likes] },
      {
        key: "WEBSITE",
        label: "Sitio web",
        destinationType: "WEBSITE",
        help: "Interacci\xF3n en el sitio web (eventos de bajo embudo).",
        ctas: WEBSITE_CTAS,
        goals: [G.lpv, G.clicks, G.webConv(["CONTENT_VIEW", "SEARCH", "ADD_TO_WISHLIST", "OTHER"])]
      },
      { key: "CALLS", label: "Llamadas", destinationType: "PHONE_CALL", help: "Llamadas a tu negocio.", ctas: CALL_CTAS, goals: [G.calls] }
    ]
  },
  {
    key: "OUTCOME_LEADS",
    label: "Clientes potenciales",
    short: "Leads",
    help: "Formularios instant\xE1neos, mensajes, llamadas o conversiones de lead en el sitio.",
    destinations: [
      {
        key: "INSTANT_FORM",
        label: "Formulario instant\xE1neo",
        destinationType: "ON_AD",
        help: "El formulario se abre dentro de Facebook/Instagram.",
        ctas: LEAD_CTAS,
        goals: [G.leadForm, G.qualityLead]
      },
      {
        key: "WEBSITE",
        label: "Sitio web",
        destinationType: "WEBSITE",
        help: "Conversiones de lead en el sitio (p\xEDxel / dataset).",
        ctas: WEBSITE_CTAS,
        goals: [G.webConv(LEAD_EVENTS), G.lpv, G.clicks]
      },
      {
        key: "WHATSAPP",
        label: "WhatsApp",
        destinationType: "WHATSAPP",
        help: "Clientes potenciales por conversaciones de WhatsApp.",
        ctas: WA_CTAS,
        goals: [G.conversations]
      },
      { key: "MESSENGER", label: "Messenger", destinationType: "MESSENGER", help: "Clientes potenciales por Messenger.", ctas: MSG_CTAS, goals: [G.conversations] },
      { key: "INSTAGRAM_DIRECT", label: "Instagram Direct", destinationType: "INSTAGRAM_DIRECT", help: "Clientes potenciales por mensaje directo.", ctas: IG_CTAS, goals: [G.conversations] },
      { key: "CALLS", label: "Llamadas", destinationType: "PHONE_CALL", help: "Llamadas de clientes potenciales.", ctas: CALL_CTAS, goals: [G.calls] }
    ]
  },
  {
    key: "OUTCOME_APP_PROMOTION",
    label: "Promoci\xF3n de la app",
    short: "App",
    help: "Instalaciones o eventos en la app (requiere app registrada y SDK / MMP).",
    destinations: [
      {
        key: "APP",
        label: "App",
        destinationType: "APP",
        help: "Instalaciones de la app.",
        ctas: ["INSTALL_MOBILE_APP", "USE_MOBILE_APP", "DOWNLOAD", "LEARN_MORE"],
        goals: [{ goal: "APP_INSTALLS", label: "Instalaciones de la app", help: "Requiere application_id y object_store_url.", billing: ["IMPRESSIONS"], requires: ["app"] }]
      }
    ]
  },
  {
    key: "OUTCOME_SALES",
    label: "Ventas",
    short: "Sales",
    help: "Compras en el sitio, en WhatsApp o por llamadas, optimizando con tu p\xEDxel o conjunto de datos.",
    destinations: [
      {
        key: "WEBSITE",
        label: "Sitio web",
        destinationType: "WEBSITE",
        help: "Conversiones del p\xEDxel / dataset.",
        ctas: WEBSITE_CTAS,
        goals: [G.webConv(WEBSITE_EVENTS), G.value, G.lpv, G.clicks, G.impressions, G.reach]
      },
      {
        key: "WHATSAPP",
        label: "WhatsApp",
        destinationType: "WHATSAPP",
        help: "Click to WhatsApp optimizando por compras reportadas por la Conversions API para mensajer\xEDa.",
        ctas: WA_CTAS,
        goals: [
          {
            goal: "OFFSITE_CONVERSIONS",
            label: "Conversiones (compras en WhatsApp)",
            billing: ["IMPRESSIONS"],
            requires: ["page", "whatsappDataset", "conversionEvent"],
            events: ["PURCHASE", "LEAD", "ADD_TO_CART", "INITIATED_CHECKOUT"],
            help: "Lo que documenta Meta para Click to WhatsApp: promoted_object con page_id + pixel_id (dataset de la WABA) + custom_event_type. Tu CRM o plataforma de WhatsApp debe enviar el evento con action_source=business_messaging."
          },
          G.conversations,
          {
            goal: "MESSAGING_PURCHASE_CONVERSION",
            label: "Compras por mensajes",
            billing: ["IMPRESSIONS"],
            requires: ["page", "whatsappDataset"],
            help: "Compras por mensajes sin evento expl\xEDcito.",
            verify: "Meta la habilita por cuenta: se valida con Meta antes de crear."
          },
          G.clicks
        ]
      },
      { key: "MESSENGER", label: "Messenger", destinationType: "MESSENGER", help: "Ventas por Messenger.", ctas: MSG_CTAS, goals: [
        G.conversations,
        { goal: "MESSAGING_PURCHASE_CONVERSION", label: "Compras por mensajes", billing: ["IMPRESSIONS"], requires: ["page"], help: "Compras reportadas en Messenger.", verify: "Meta la habilita por cuenta." }
      ] },
      { key: "CALLS", label: "Llamadas", destinationType: "PHONE_CALL", help: "Ventas por llamadas.", ctas: CALL_CTAS, goals: [G.calls] }
    ]
  }
];
var OBJECTIVE_BY_KEY = Object.fromEntries(OBJECTIVES.map((o) => [o.key, o]));
var OBJECTIVE_LABEL = {
  ...Object.fromEntries(OBJECTIVES.map((o) => [o.key, o.label])),
  /* Objetivos heredados que aún aparecen en campañas antiguas. */
  LINK_CLICKS: "Tr\xE1fico (heredado)",
  CONVERSIONS: "Conversiones (heredado)",
  MESSAGES: "Mensajes (heredado)",
  LEAD_GENERATION: "Clientes potenciales (heredado)",
  POST_ENGAGEMENT: "Interacci\xF3n (heredado)",
  BRAND_AWARENESS: "Reconocimiento (heredado)",
  REACH: "Alcance (heredado)",
  VIDEO_VIEWS: "Reproducciones (heredado)",
  PRODUCT_CATALOG_SALES: "Ventas del cat\xE1logo (heredado)"
};
function findDestination(objective, destination) {
  return OBJECTIVE_BY_KEY[objective]?.destinations.find((d) => d.key === destination);
}
function findGoal(objective, destination, goal) {
  return findDestination(objective, destination)?.goals.find((g) => g.goal === goal);
}
function destinationKeyFromAdset(destinationType, goal) {
  const d = String(destinationType || "").toUpperCase();
  if (d === "WHATSAPP") return "WHATSAPP";
  if (d === "MESSENGER") return "MESSENGER";
  if (d === "INSTAGRAM_DIRECT") return "INSTAGRAM_DIRECT";
  if (d.startsWith("MESSAGING_")) return "MESSAGING_APPS";
  if (d === "PHONE_CALL") return "CALLS";
  if (d === "ON_PAGE") return "ON_PAGE";
  if (d === "APP") return "APP";
  if ((d === "ON_AD" || d === "UNDEFINED" || !d) && (goal === "LEAD_GENERATION" || goal === "QUALITY_LEAD")) return "INSTANT_FORM";
  if (d === "ON_AD" || d === "ON_POST") return "ON_AD";
  if (d === "WEBSITE") return "WEBSITE";
  return "NONE";
}
var RETIRED_POSITIONS = {
  /* v26.0: Meta retir\xF3 Explorar de Instagram (explore, explore_home, ig_search) e Historias de Messenger. */
  instagram_positions: ["explore", "explore_home", "ig_search"],
  messenger_positions: ["story", "sponsored_messages"],
  whatsapp_positions: ["status"]
};

// server/meta/mock.ts
var S = { objs: /* @__PURE__ */ new Map(), seq: 1e3, seeded: false };
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString().replace("Z", "+0000");
var daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().replace("Z", "+0000");
var newId = () => "12025" + String(++S.seq).padStart(13, "0");
function put(o) {
  S.objs.set(String(o.id), o);
  return o;
}
function all(type, f = () => true) {
  return [...S.objs.values()].filter((o) => o.__type === type && f(o));
}
function seed() {
  if (S.seeded) return;
  S.seeded = true;
  put({ __type: "business", id: "b1", name: "ABCW Global", verification_status: "verified" });
  put({ __type: "business", id: "b2", name: "izzi Telecom", verification_status: "verified" });
  const acc = (id, name, currency, biz, extra = {}) => put({
    __type: "account",
    id: "act_" + id,
    account_id: id,
    name,
    currency,
    timezone_name: currency === "COP" ? "America/Bogota" : "America/Mexico_City",
    account_status: 1,
    disable_reason: 0,
    amount_spent: "184523300",
    spend_cap: "0",
    min_daily_budget: currency === "COP" ? "4000" : "2000",
    business: { id: biz, name: biz === "b1" ? "ABCW Global" : "izzi Telecom" },
    ...extra
  });
  acc("100000000000001", "izzi \xB7 Always On", "MXN", "b2");
  acc("100000000000002", "Sky \xB7 Performance", "MXN", "b2");
  acc("100000000000003", "ABCW \xB7 Colombia", "COP", "b1");
  acc("100000000000004", "Cliente con restricci\xF3n", "MXN", "b1", { account_status: 2, disable_reason: 1 });
  put({ __type: "page", id: "200001", name: "izzi", whatsapp_number: "+525512345678", instagram_business_account: { id: "300001", username: "izzimx" }, access_token: "page-token-1", leadgen_tos_accepted: true, __accounts: ["act_100000000000001", "act_100000000000002"] });
  put({ __type: "page", id: "200002", name: "Sky M\xE9xico", whatsapp_number: "", instagram_business_account: { id: "300002", username: "skymx" }, access_token: "page-token-2", leadgen_tos_accepted: false, __accounts: ["act_100000000000002"] });
  put({ __type: "page", id: "200003", name: "ABCW", whatsapp_number: "+573001112233", instagram_business_account: null, access_token: "page-token-3", leadgen_tos_accepted: true, __accounts: ["act_100000000000003", "act_100000000000001"] });
  put({ __type: "waba", id: "400001", name: "izzi WhatsApp Ventas", currency: "MXN", account_review_status: "APPROVED", __biz: "b2", __dataset: "500900" });
  put({ __type: "waba", id: "400002", name: "ABCW WhatsApp", currency: "COP", account_review_status: "APPROVED", __biz: "b1", __dataset: "" });
  put({ __type: "phone", id: "410001", __waba: "400001", display_phone_number: "+52 55 1234 5678", verified_name: "izzi", quality_rating: "GREEN", status: "CONNECTED", name_status: "APPROVED", code_verification_status: "VERIFIED", platform_type: "CLOUD_API", throughput: { level: "STANDARD" } });
  put({ __type: "phone", id: "410002", __waba: "400001", display_phone_number: "+52 55 8765 4321", verified_name: "izzi Soporte", quality_rating: "YELLOW", status: "CONNECTED", name_status: "APPROVED", code_verification_status: "VERIFIED", platform_type: "CLOUD_API", throughput: { level: "STANDARD" } });
  put({ __type: "page", id: "200004", name: "izzi telecom", instagram_business_account: { id: "300004", username: "izzitelecom" }, access_token: "page-token-4", leadgen_tos_accepted: true, __waLinked: true, __accounts: ["act_100000000000001"] });
  put({ __type: "waba", id: "400003", name: "izzi telecom \xB7 Ventas WhatsApp", currency: "MXN", account_review_status: "APPROVED", __biz: "b9", __dataset: "500901" });
  put({ __type: "phone", id: "410004", __waba: "400003", display_phone_number: "+52 1 55 4000 1234", verified_name: "izzi telecom", quality_rating: "GREEN", status: "CONNECTED", name_status: "APPROVED", code_verification_status: "VERIFIED", platform_type: "CLOUD_API", throughput: { level: "STANDARD" } });
  put({ __type: "phone", id: "410003", __waba: "400002", display_phone_number: "+57 300 111 2233", verified_name: "ABCW", quality_rating: "GREEN", status: "CONNECTED", name_status: "APPROVED", code_verification_status: "VERIFIED", platform_type: "CLOUD_API", throughput: { level: "STANDARD" } });
  put({ __type: "pixel", id: "500001", name: "izzi.mx \xB7 Pixel", last_fired_time: daysAgo(0.02), is_unavailable: false, creation_time: daysAgo(900), owner_business: { id: "b2", name: "izzi Telecom" }, __accounts: ["act_100000000000001", "act_100000000000002"] });
  put({ __type: "pixel", id: "500002", name: "Sky \xB7 Pixel", last_fired_time: daysAgo(12), is_unavailable: false, creation_time: daysAgo(600), owner_business: { id: "b2", name: "izzi Telecom" }, __accounts: ["act_100000000000002"] });
  put({ __type: "pixel", id: "500900", name: "izzi WhatsApp \xB7 Dataset (CAPI mensajer\xEDa)", last_fired_time: daysAgo(0.1), is_unavailable: false, creation_time: daysAgo(200), owner_business: { id: "b2", name: "izzi Telecom" }, __accounts: ["act_100000000000001"] });
  put({ __type: "pixel", id: "500901", name: "izzi telecom \xB7 Dataset WhatsApp (solo CAPI)", is_unavailable: false, creation_time: daysAgo(120), owner_business: { id: "b9", name: "izzi telecom" }, __accounts: ["act_100000000000001"] });
  put({ __type: "pixel", id: "500003", name: "ABCW \xB7 Pixel", last_fired_time: daysAgo(1), creation_time: daysAgo(300), __accounts: ["act_100000000000003"] });
  put({ __type: "cc", id: "510001", name: "Lead \xB7 Contrataci\xF3n completada", custom_event_type: "LEAD", last_fired_time: daysAgo(0.3), is_archived: false, rule: '{"and":[{"event":{"eq":"Lead"}},{"url":{"i_contains":"gracias"}}]}', pixel: { id: "500001" }, __account: "act_100000000000001" });
  put({ __type: "catalog", id: "520001", name: "Paquetes izzi", product_count: 48, vertical: "commerce", __biz: "b2" });
  const aud = (id, name, subtype, lo, hi, acc2 = "act_100000000000001", extra = {}) => put({
    __type: "audience",
    id,
    name,
    subtype,
    __account: acc2,
    approximate_count_lower_bound: lo,
    approximate_count_upper_bound: hi,
    time_updated: Math.floor(Date.now() / 1e3) - 3600 * 5,
    time_created: Math.floor(Date.now() / 1e3) - 86400 * 60,
    delivery_status: { code: 200, description: "Este p\xFAblico est\xE1 listo." },
    operation_status: { code: 200, description: "Normal" },
    retention_days: 30,
    ...extra
  });
  aud("600001", "Clientes activos izzi (CRM)", "CUSTOM", 82e4, 965e3);
  aud("600002", "Visitantes sitio 30 d", "WEBSITE", 12e5, 14e5, "act_100000000000001", { rule: '{"inclusions":{"operator":"or","rules":[{"event_sources":[{"id":"500001","type":"pixel"}],"retention_seconds":2592000}]}}' });
  aud("600003", "Interacci\xF3n Instagram 90 d", "ENGAGEMENT", 31e4, 365e3, "act_100000000000001", { rule: '{"inclusions":{"operator":"or","rules":[{"event_sources":[{"id":"300001","type":"ig_business"}],"retention_seconds":7776000}]}}' });
  aud("600004", "Interacci\xF3n p\xE1gina izzi 365 d", "ENGAGEMENT", 21e5, 25e5, "act_100000000000001", { rule: '{"inclusions":{"operator":"or","rules":[{"event_sources":[{"id":"200001","type":"page"}],"retention_seconds":31536000}]}}' });
  aud("600005", "Video 75 % \xB7 Lanzamiento", "VIDEO", 15e4, 18e4);
  aud("600006", "LAL 1 % \xB7 Clientes activos MX", "LOOKALIKE", 9e5, 11e5, "act_100000000000001", { lookalike_spec: { ratio: 0.01, country: "MX", origin: [{ id: "600001", name: "Clientes activos izzi (CRM)" }] } });
  aud("600007", "Conversaciones WhatsApp 60 d", "ENGAGEMENT", 45e3, 53e3, "act_100000000000001", { rule: '{"inclusions":{"operator":"or","rules":[{"event_sources":[{"id":"400001","type":"whatsapp"}]}]}}' });
  aud("600008", "Leads formulario 30 d", "ENGAGEMENT", 12e3, 14e3, "act_100000000000001", { rule: '{"inclusions":{"operator":"or","rules":[{"event_sources":[{"id":"200001","type":"lead"}]}]}}', delivery_status: { code: 300, description: "P\xFAblico demasiado peque\xF1o." } });
  aud("600009", "Compradores Sky", "CUSTOM", 0, 0, "act_100000000000002", { operation_status: { code: 441, description: "Se est\xE1 subiendo la lista." } });
  put({ __type: "saved", id: "610001", name: "CDMX 25-54 intereses tecnolog\xEDa", __account: "act_100000000000001", targeting: { geo_locations: { regions: [{ key: "1024", name: "Ciudad de M\xE9xico" }] }, age_min: 25, age_max: 54 }, time_updated: daysAgo(10) });
  put({ __type: "form", id: "700001", name: "Cotiza izzi \xB7 Internet", status: "ACTIVE", leads_count: 1832, created_time: daysAgo(40), __page: "200001", locale: "es_LA" });
  put({ __type: "form", id: "700002", name: "Borrador \xB7 Sky", status: "DRAFT", leads_count: 0, created_time: daysAgo(3), __page: "200002", locale: "es_LA" });
  const plan = [
    ["act_100000000000001", "MXN - IZZI WHATSAPP / Always On", "OUTCOME_ENGAGEMENT", "WHATSAPP", "CONVERSATIONS", "CBO", 12e3],
    ["act_100000000000001", "MXN - IZZI WHATSAPP / NO FTTH \xB7 Compras", "OUTCOME_SALES", "WHATSAPP", "OFFSITE_CONVERSIONS", "ABO", 6e3],
    ["act_100000000000001", "MXN - IZZI LEADS / Formulario Internet", "OUTCOME_LEADS", "INSTANT_FORM", "LEAD_GENERATION", "CBO", 8e3],
    ["act_100000000000001", "MXN - IZZI WEB / Ventas online", "OUTCOME_SALES", "WEBSITE", "OFFSITE_CONVERSIONS", "CBO", 15e3],
    ["act_100000000000001", "MXN - IZZI TRAFICO / Promo Septiembre", "OUTCOME_TRAFFIC", "WEBSITE", "LANDING_PAGE_VIEWS", "ABO", 3e3],
    ["act_100000000000001", "MXN - IZZI ALCANCE / Marca", "OUTCOME_AWARENESS", "NONE", "REACH", "CBO", 5e3],
    ["act_100000000000002", "SKY - WHATSAPP / Conversaciones", "OUTCOME_ENGAGEMENT", "WHATSAPP", "CONVERSATIONS", "ABO", 4e3],
    ["act_100000000000002", "SKY - WEB / Leads sitio", "OUTCOME_LEADS", "WEBSITE", "OFFSITE_CONVERSIONS", "CBO", 7e3],
    ["act_100000000000003", "COP - ABCW / Leads formulario", "OUTCOME_LEADS", "INSTANT_FORM", "LEAD_GENERATION", "ABO", 6e4],
    ["act_100000000000003", "COP - ABCW / WhatsApp", "OUTCOME_ENGAGEMENT", "WHATSAPP", "CONVERSATIONS", "CBO", 12e4],
    ["act_100000000000001", "MXN - IZZI TELECOM WHATSAPP / Compras por mensajes", "OUTCOME_SALES", "WHATSAPP", "OFFSITE_CONVERSIONS", "CBO", 9e3]
  ];
  const regions2 = ["Ciudad de M\xE9xico", "Jalisco", "Nuevo Le\xF3n", "Estado de M\xE9xico", "Puebla"];
  plan.forEach(([acc2, name, objective, dest, goal, mode, budget], ci) => {
    const accObj = S.objs.get(acc2);
    const off = accObj.currency === "COP" ? 1 : 100;
    const cid = newId();
    const paused = ci === 4;
    put({
      __type: "campaign",
      id: cid,
      account_id: acc2,
      name,
      objective,
      status: paused ? "PAUSED" : "ACTIVE",
      effective_status: paused ? "PAUSED" : "ACTIVE",
      buying_type: "AUCTION",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      special_ad_categories: [],
      created_time: daysAgo(40 + ci),
      updated_time: daysAgo(2),
      start_time: daysAgo(40 + ci),
      ...mode === "CBO" ? { daily_budget: String(budget * off) } : { is_adset_budget_sharing_enabled: false },
      ...ci === 5 ? { lifetime_budget: String(budget * 30 * off), daily_budget: void 0, stop_time: new Date(Date.now() + 12 * 864e5).toISOString() } : {}
    });
    const nAdsets = ci % 3 === 0 ? 4 : 2;
    for (let j = 0; j < nAdsets; j++) {
      const aid = newId();
      const telecom = name.includes("TELECOM");
      const page = telecom ? "200004" : acc2 === "act_100000000000003" ? "200003" : acc2 === "act_100000000000002" ? "200002" : "200001";
      const po = {};
      const dk = dest;
      if (["WHATSAPP", "INSTANT_FORM"].includes(dk) || goal === "CONVERSATIONS") po.page_id = page;
      if (dk === "WHATSAPP" && goal === "OFFSITE_CONVERSIONS") {
        po.pixel_id = telecom ? "500901" : "500900";
        po.custom_event_type = "PURCHASE";
      }
      if (telecom) po.whatsapp_phone_number = "+5215540001234";
      if (dk === "WEBSITE" && goal === "OFFSITE_CONVERSIONS") {
        po.pixel_id = acc2 === "act_100000000000002" ? "500002" : "500001";
        po.custom_event_type = objective === "OUTCOME_LEADS" ? "LEAD" : "PURCHASE";
      }
      const region = regions2[(ci + j) % regions2.length];
      const st = j === nAdsets - 1 && ci % 2 === 1 ? "PAUSED" : "ACTIVE";
      put({
        __type: "adset",
        id: aid,
        account_id: acc2,
        campaign_id: cid,
        name: `${region} \xB7 ${["25-44", "18-34", "35-54", "25-54"][j % 4]} \xB7 ${goal === "CONVERSATIONS" ? "Conv" : goal === "LEAD_GENERATION" ? "Form" : "Conv web"}`,
        status: st,
        effective_status: paused ? "CAMPAIGN_PAUSED" : st,
        optimization_goal: goal,
        billing_event: "IMPRESSIONS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        destination_type: dest === "INSTANT_FORM" ? "ON_AD" : dest === "NONE" ? void 0 : dest,
        promoted_object: Object.keys(po).length ? po : void 0,
        targeting: {
          geo_locations: { regions: [{ key: String(1e3 + j), name: region, country: "MX" }] },
          age_min: 25,
          age_max: 54,
          targeting_automation: { advantage_audience: j % 2 },
          custom_audiences: j === 0 ? [{ id: "600002", name: "Visitantes sitio 30 d" }] : void 0,
          excluded_custom_audiences: j === 1 ? [{ id: "600001", name: "Clientes activos izzi (CRM)" }] : void 0
        },
        ...mode === "ABO" ? { daily_budget: String(Math.round(budget / nAdsets) * off) } : {},
        start_time: daysAgo(40 + ci),
        end_time: ci === 5 ? new Date(Date.now() + 12 * 864e5).toISOString() : void 0,
        attribution_spec: goal === "OFFSITE_CONVERSIONS" ? [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }] : void 0,
        learning_stage_info: { status: j === 1 && ci % 2 === 0 ? "FAIL" : j === 2 ? "LEARNING" : "SUCCESS" },
        created_time: daysAgo(40 + ci),
        updated_time: daysAgo(3)
      });
      const nAds = 2 + (ci + j) % 2;
      for (let k = 0; k < nAds; k++) {
        const crid = newId(), adid = newId();
        const wa = dest === "WHATSAPP";
        const link = wa ? "https://api.whatsapp.com/send" : dest === "INSTANT_FORM" ? "http://fb.me/" : "https://www.izzi.mx/internet";
        const cta = wa ? { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } } : dest === "INSTANT_FORM" ? { type: "SIGN_UP", value: { lead_gen_form_id: "700001", link } } : { type: "LEARN_MORE", value: { link } };
        put({
          __type: "creative",
          id: crid,
          account_id: acc2,
          name: `Creativo ${k + 1}`,
          url_tags: wa || dest === "INSTANT_FORM" ? void 0 : "utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
          thumbnail_url: `https://picsum.photos/seed/${crid}/120/120`,
          object_story_spec: { page_id: page, instagram_user_id: page === "200001" ? "300001" : void 0, link_data: { link, page_welcome_message: wa ? JSON.stringify({ type: "VISUAL_EDITOR", version: 2, landing_screen_type: "welcome_message", media_type: "text", text_format: { customer_action_type: "autofill_message", message: { text: "\xA1Hola! Te ayudamos a contratar tu paquete.", autofill_message: { content: "Hola, quiero contratar internet." }, ice_breakers: [] } } }) : void 0, message: ["Internet de fibra \xF3ptica desde $349 al mes.", "Contrata hoy y recibe instalaci\xF3n gratis.", "\xBFTienes dudas? Escr\xEDbenos por WhatsApp."][k % 3], name: ["Internet + TV", "Instalaci\xF3n gratis", "Habla con un asesor"][k % 3], image_hash: "hash" + crid, call_to_action: cta } }
        });
        const rejected = ci === 1 && j === 0 && k === 1;
        const adSt = rejected ? "ACTIVE" : k === 2 ? "PAUSED" : "ACTIVE";
        put({
          __type: "ad",
          id: adid,
          account_id: acc2,
          campaign_id: cid,
          adset_id: aid,
          name: `${name.split("/").pop().trim()} \xB7 Anuncio ${k + 1}`,
          status: adSt,
          effective_status: rejected ? "DISAPPROVED" : paused ? "CAMPAIGN_PAUSED" : st === "PAUSED" ? "ADSET_PAUSED" : adSt,
          creative: { id: crid },
          ad_review_feedback: rejected ? { global: { "Contenido enga\xF1oso": "El anuncio promete resultados que no se pueden garantizar." } } : void 0,
          created_time: daysAgo(30),
          updated_time: daysAgo(1)
        });
      }
    }
  });
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
function dayMetrics(adId, date) {
  const ad = S.objs.get(adId);
  const adset = S.objs.get(ad.adset_id);
  const camp = S.objs.get(ad.campaign_id);
  if (Date.parse(date) < Date.parse(String(ad.created_time).replace("+0000", "Z")) - 864e5) return null;
  if (ad.status !== "ACTIVE" || adset.status !== "ACTIVE" || camp.status !== "ACTIVE" || ad.effective_status === "DISAPPROVED") {
    if (Date.now() - Date.parse(date) < 5 * 864e5) return null;
  }
  const acc = S.objs.get(ad.account_id);
  const fx = acc.currency === "COP" ? 210 : 1;
  const r = hash(adId + date), r2 = hash(date + adId + "x");
  const trend = 1 + (hash(adId) - 0.5) * 0.02 * ((Date.now() - Date.parse(date)) / 864e5);
  const spend = (180 + r * 520) * fx * trend;
  const cpm = (55 + r2 * 60) * fx;
  const impressions = Math.round(spend / cpm * 1e3);
  const freq = 1.3 + hash(adset.id) * 2.9 + (r2 > 0.8 ? 1.4 : 0);
  const reach = Math.round(impressions / freq);
  const ctr = 6e-3 + hash(ad.id + "ctr") * 0.018 * (0.85 + r * 0.3);
  const clicks = Math.round(impressions * ctr);
  const link = Math.round(clicks * 0.72);
  const goal = adset.optimization_goal;
  const actions = [{ action_type: "link_click", value: String(link) }, { action_type: "landing_page_view", value: String(Math.round(link * 0.8)) }, { action_type: "post_engagement", value: String(Math.round(clicks * 1.6)) }];
  const values = [];
  if (goal === "CONVERSATIONS" || adset.destination_type === "WHATSAPP") actions.push({ action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(Math.round(link * (0.22 + r * 0.1))) });
  if (goal === "LEAD_GENERATION" || camp.objective === "OUTCOME_LEADS") actions.push({ action_type: "lead", value: String(Math.round(link * (0.06 + r2 * 0.05))) });
  if (camp.objective === "OUTCOME_SALES") {
    const p = Math.round(link * (0.012 + r * 0.02));
    actions.push({ action_type: "omni_purchase", value: String(p) });
    values.push({ action_type: "omni_purchase", value: String(p * (549 + r2 * 400) * fx) });
  }
  return { spend, impressions, reach, clicks, inline_link_clicks: link, actions, action_values: values };
}
function sumRaw(list2) {
  const t = { spend: 0, impressions: 0, reach: 0, clicks: 0, inline_link_clicks: 0, actions: /* @__PURE__ */ new Map(), action_values: /* @__PURE__ */ new Map() };
  list2.forEach((x) => {
    t.spend += x.spend;
    t.impressions += x.impressions;
    t.reach += x.reach;
    t.clicks += x.clicks;
    t.inline_link_clicks += x.inline_link_clicks;
    x.actions.forEach((a) => t.actions.set(a.action_type, (t.actions.get(a.action_type) || 0) + Number(a.value)));
    x.action_values.forEach((a) => t.action_values.set(a.action_type, (t.action_values.get(a.action_type) || 0) + Number(a.value)));
  });
  t.reach = Math.round(t.reach * (list2.length > 1 ? 0.78 : 1));
  return {
    spend: t.spend.toFixed(2),
    impressions: String(t.impressions),
    reach: String(t.reach),
    clicks: String(t.clicks),
    inline_link_clicks: String(t.inline_link_clicks),
    frequency: t.reach ? (t.impressions / t.reach).toFixed(4) : "0",
    ctr: t.impressions ? (t.clicks / t.impressions * 100).toFixed(4) : "0",
    cpc: t.clicks ? (t.spend / t.clicks).toFixed(4) : "0",
    cpm: t.impressions ? (t.spend / t.impressions * 1e3).toFixed(4) : "0",
    actions: [...t.actions.entries()].map(([action_type, v2]) => ({ action_type, value: String(Math.round(v2)) })),
    action_values: [...t.action_values.entries()].map(([action_type, v2]) => ({ action_type, value: v2.toFixed(2) }))
  };
}
var BREAKDOWN_VALUES = {
  age: [["18-24", 0.12], ["25-34", 0.34], ["35-44", 0.28], ["45-54", 0.16], ["55-64", 0.07], ["65+", 0.03]],
  gender: [["female", 0.52], ["male", 0.46], ["unknown", 0.02]],
  country: [["MX", 0.97], ["US", 0.03]],
  region: [["Ciudad de M\xE9xico", 0.31], ["Jalisco", 0.16], ["Nuevo Le\xF3n", 0.14], ["Estado de M\xE9xico", 0.21], ["Puebla", 0.08], ["Veracruz", 0.1]],
  dma: [["unknown", 1]],
  publisher_platform: [["facebook", 0.46], ["instagram", 0.49], ["messenger", 0.02], ["audience_network", 0.03]],
  platform_position: [["feed", 0.5], ["instagram_stories", 0.2], ["instagram_reels", 0.18], ["marketplace", 0.07], ["facebook_stories", 0.05]],
  impression_device: [["android_smartphone", 0.62], ["iphone", 0.31], ["desktop", 0.05], ["ipad", 0.02]],
  device_platform: [["mobile_app", 0.9], ["mobile_web", 0.05], ["desktop", 0.05]],
  hourly_stats_aggregated_by_advertiser_time_zone: Array.from({ length: 24 }, (_, h) => [`${String(h).padStart(2, "0")}:00:00 - ${String(h).padStart(2, "0")}:59:59`, [1, 0.6, 0.4, 0.3, 0.3, 0.5, 1, 2, 3, 4, 5, 5.5, 6, 6, 5.5, 5.5, 6, 6.5, 7, 7.5, 7, 6, 4, 2][h] / 100])
};
function scaleRaw(r, f, k) {
  const j = 0.85 + hash(k) * 0.3;
  const m = f * j;
  const n2 = (v2) => String(Math.round(Number(v2) * m));
  const spend = Number(r.spend) * m;
  return {
    ...r,
    spend: spend.toFixed(2),
    impressions: n2(r.impressions),
    reach: n2(r.reach),
    clicks: n2(r.clicks),
    inline_link_clicks: n2(r.inline_link_clicks),
    actions: r.actions.map((a) => ({ ...a, value: String(Math.round(Number(a.value) * m * (0.8 + hash(k + a.action_type) * 0.4))) })),
    action_values: r.action_values.map((a) => ({ ...a, value: (Number(a.value) * m).toFixed(2) }))
  };
}
function insightsFor(act, q) {
  const level = q.get("level") || "account";
  const tr = JSON.parse(q.get("time_range") || "{}");
  const since = tr.since || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const until = tr.until || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const inc = q.get("time_increment");
  const breakdowns = JSON.parse(q.get("breakdowns") || "[]");
  const filtering = JSON.parse(q.get("filtering") || "[]");
  let ads = all("ad", (a) => a.account_id === act);
  filtering.forEach((f) => {
    const [lvl] = String(f.field).split(".");
    const ids = (f.value || []).map(String);
    ads = ads.filter((a) => ids.includes(lvl === "campaign" ? a.campaign_id : lvl === "adset" ? a.adset_id : a.id));
  });
  const dates = [];
  for (let d = /* @__PURE__ */ new Date(since + "T00:00:00Z"); d <= /* @__PURE__ */ new Date(until + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const groups = /* @__PURE__ */ new Map();
  for (const a of ads) for (const dt of dates) {
    const m = dayMetrics(a.id, dt);
    if (!m) continue;
    const idk = level === "campaign" ? a.campaign_id : level === "adset" ? a.adset_id : level === "ad" ? a.id : act;
    const k = idk + "|" + (inc === "1" ? dt : "");
    if (!groups.has(k)) {
      const base = { date_start: inc === "1" ? dt : since, date_stop: inc === "1" ? dt : until };
      if (level !== "account") {
        base.campaign_id = a.campaign_id;
        base.campaign_name = S.objs.get(a.campaign_id).name;
      }
      if (level === "adset" || level === "ad") {
        base.adset_id = a.adset_id;
        base.adset_name = S.objs.get(a.adset_id).name;
      }
      if (level === "ad") {
        base.ad_id = a.id;
        base.ad_name = a.name;
      }
      groups.set(k, { base, items: [] });
    }
    groups.get(k).items.push(m);
  }
  let rows = [...groups.values()].map((g) => ({ ...g.base, ...sumRaw(g.items) }));
  for (const b of breakdowns) {
    const vals = BREAKDOWN_VALUES[b] || [["unknown", 1]];
    rows = rows.flatMap((r) => vals.map(([v2, f]) => ({ ...scaleRaw(r, f, r.date_start + v2 + (r.ad_id || r.adset_id || r.campaign_id || "")), [b]: v2 })));
  }
  if (breakdowns.includes("hourly_stats_aggregated_by_advertiser_time_zone")) rows = rows.map((r) => {
    const x = { ...r };
    delete x.reach;
    delete x.frequency;
    return x;
  });
  return rows;
}
function ok(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "x-app-usage": JSON.stringify({ call_count: 3, total_cputime: 2, total_time: 2 }) } });
}
function fail(code, message2, subcode, userMsg, blame, status = 400) {
  return ok({ error: {
    message: message2,
    type: "OAuthException",
    code,
    error_subcode: subcode,
    error_user_title: userMsg ? "Error" : void 0,
    error_user_msg: userMsg,
    error_data: blame ? JSON.stringify({ blame_field_specs: [blame] }) : void 0,
    fbtrace_id: "Amock" + Math.floor(Math.random() * 1e6)
  } }, status);
}
function list(data) {
  return ok({ data, paging: { cursors: { before: "a", after: "b" } } });
}
function project(o, fields) {
  if (!o) return {};
  const out = {};
  const clean = (x) => Object.fromEntries(Object.entries(x).filter(([k, v2]) => !k.startsWith("__") && v2 !== void 0));
  if (!fields) return clean(o);
  const top = splitFields(fields);
  for (const f of top) {
    const m = f.match(/^([a-z_]+)(\{(.*)\})?(\..*)?$/);
    if (!m) continue;
    const name = m[1];
    if (name === "creative" && o.creative?.id) {
      out.creative = project(S.objs.get(o.creative.id), m[3]);
      continue;
    }
    if (name === "business" && o.business) {
      out.business = o.business;
      continue;
    }
    if (name === "campaign" && o.campaign_id) {
      out.campaign = project(S.objs.get(String(o.campaign_id)), m[3] || "id,name");
      continue;
    }
    if (name === "ads" && o.__type === "adset") {
      const sub = m[3] || (m[4] || "").replace(/^[^{]*\{/, "").replace(/\}$/, "") || "id";
      const lim = Number(((m[4] || "").match(/limit\((\d+)\)/) || [])[1] || 25);
      out.ads = { data: all("ad", (x) => x.adset_id === o.id).slice(0, lim).map((x) => project(x, sub)) };
      continue;
    }
    if (name === "picture") {
      out.picture = { data: { url: "https://picsum.photos/seed/" + o.id + "/64" } };
      continue;
    }
    if (name === "pixel" && o.pixel) {
      out.pixel = o.pixel;
      continue;
    }
    if (o[name] !== void 0) out[name] = o[name];
  }
  if (o.id) out.id = o.id;
  return out;
}
function splitFields(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function parseBody(init) {
  const out = {};
  const p = new URLSearchParams(String(init.body || ""));
  p.forEach((v2, k) => {
    try {
      out[k] = /^[[{]/.test(v2) ? JSON.parse(v2) : v2;
    } catch {
      out[k] = v2;
    }
  });
  return out;
}
function validateAdset(act, p) {
  const camp = S.objs.get(String(p.campaign_id));
  if (!camp || camp.__type !== "campaign") return fail(100, "Invalid parameter", 1885014, "La campa\xF1a no existe.", ["campaign_id"]);
  if (!p.name) return fail(100, "Invalid parameter", 1885030, "El conjunto necesita un nombre.", ["name"]);
  if (!p.targeting?.geo_locations || !Object.keys(p.targeting.geo_locations).length) return fail(100, "Invalid parameter", 1885363, "Falta la ubicaci\xF3n de la segmentaci\xF3n.", ["targeting"]);
  const cbo = !!(Number(camp.daily_budget) || Number(camp.lifetime_budget));
  if (cbo && (p.daily_budget || p.lifetime_budget)) return fail(100, "Invalid parameter", 1885621, "No se puede fijar presupuesto en el conjunto de una campa\xF1a con presupuesto de campa\xF1a.", ["daily_budget"]);
  if (!cbo && !p.daily_budget && !p.lifetime_budget) return fail(100, "Invalid parameter", 1885272, "Falta el presupuesto del conjunto.", ["daily_budget"]);
  const accObj = S.objs.get(act);
  if (p.daily_budget && Number(p.daily_budget) < Number(accObj.min_daily_budget)) return fail(100, "Invalid parameter", 1885272, `El presupuesto diario debe ser al menos ${Number(accObj.min_daily_budget) / (accObj.currency === "COP" ? 1 : 100)} ${accObj.currency}.`, ["daily_budget"]);
  const strat = camp.bid_strategy || p.bid_strategy;
  if ((strat === "COST_CAP" || strat === "LOWEST_COST_WITH_BID_CAP") && !p.bid_amount) return fail(100, "Invalid parameter", 1815857, "Falta el monto de puja.", ["bid_amount"]);
  const obj = camp.objective, goal = p.optimization_goal;
  const dk = destinationKeyFromAdset(p.destination_type, goal);
  const dest = findDestination(obj, dk === "ON_AD" && obj === "OUTCOME_LEADS" ? "INSTANT_FORM" : dk);
  const po = p.promoted_object || {};
  if (obj === "OUTCOME_ENGAGEMENT" && goal === "MESSAGING_PURCHASE_CONVERSION") return fail(100, "Invalid parameter", 2490408, "No puedes usar el objetivo de rendimiento seleccionado con tu objetivo de campa\xF1a.", ["optimization_goal"]);
  if (!dest || !dest.goals.some((g) => g.goal === goal)) return fail(100, "Invalid parameter", 2490408, "No puedes usar el objetivo de rendimiento seleccionado con tu objetivo de campa\xF1a.", ["optimization_goal"]);
  if (p.destination_type === "WHATSAPP") {
    const page = S.objs.get(String(po.page_id));
    if (!page) return fail(100, "Invalid parameter", 1885998, "Falta la p\xE1gina en promoted_object.", ["promoted_object"]);
    if (!page.whatsapp_number && !page.__waLinked) return fail(100, "Invalid parameter", 2446886, "La p\xE1gina no tiene una cuenta de WhatsApp vinculada.", ["promoted_object"]);
    if (po.whatsapp_phone_number) {
      const d = String(po.whatsapp_phone_number).replace(/\D/g, "");
      const phones = all("phone").map((x) => x.display_phone_number.replace(/\D/g, ""));
      if (!phones.includes(d) && !String(page.whatsapp_number || "").replace(/\D/g, "").endsWith(d.slice(-10))) return fail(100, "Invalid parameter", 1487246, "El n\xFAmero de WhatsApp no est\xE1 vinculado.", ["promoted_object"]);
    }
    if (goal === "OFFSITE_CONVERSIONS" && (!po.pixel_id || !po.custom_event_type)) return fail(100, "Invalid parameter", 1885011, "Falta el conjunto de datos y el evento en promoted_object.", ["promoted_object"]);
  }
  if (goal === "OFFSITE_CONVERSIONS" || goal === "VALUE") {
    if (!po.pixel_id) return fail(100, "Invalid parameter", 1885011, "Falta pixel_id en promoted_object.", ["promoted_object"]);
    const px = S.objs.get(String(po.pixel_id));
    if (!px || !(px.__accounts || []).includes(act)) return fail(100, "Invalid parameter", 33, "Unsupported get request. Object with ID does not exist, cannot be loaded due to missing permissions, or does not support this operation.", ["promoted_object"]);
  }
  if ((goal === "LEAD_GENERATION" || goal === "CONVERSATIONS") && !po.page_id) return fail(100, "Invalid parameter", 1885998, "Falta page_id en promoted_object.", ["promoted_object"]);
  for (const a of [...p.targeting.custom_audiences || [], ...p.targeting.excluded_custom_audiences || []]) {
    const au = S.objs.get(String(a.id));
    if (!au || au.__account !== act) return fail(100, "Invalid parameter", 1713025, `El p\xFAblico ${a.id} no existe en esta cuenta.`, ["targeting"]);
  }
  if (p.targeting.targeting_automation?.advantage_audience === 1 && p.targeting.age_max && p.targeting.age_max < 65) return fail(100, "Invalid parameter", 1870189, "Con Advantage+ audience la edad m\xE1xima no puede ser menor a 65.", ["targeting"]);
  return null;
}
async function mockTransport(url, init) {
  seed();
  await new Promise((r) => setTimeout(r, 15 + Math.random() * 40));
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean).slice(1);
  const q = u.searchParams;
  const method = String(init.method || "GET").toUpperCase();
  const body = method === "POST" ? parseBody(init) : {};
  const auth = String(init.headers?.Authorization || "");
  if (!auth.includes("mock-token") && !auth.includes("page-token") && !auth.includes("|") && !q.get("input_token")) return fail(190, "Invalid OAuth access token - Cannot parse access token", void 0, void 0, void 0, 400);
  const fields = q.get("fields");
  const [a, b] = parts;
  if (method === "POST" && parts.length === 0 && body.batch) {
    const out = [];
    for (const r of body.batch) {
      const init2 = { method: r.method, headers: init.headers, body: r.body || void 0 };
      const res = await mockTransport(`https://graph.facebook.com/${env.metaVersion}/${r.relative_url}`, init2);
      out.push({ code: res.status, body: await res.text() });
    }
    return ok(out);
  }
  if (a === "me" && !b) return ok({ id: "9001", name: "PMOS System User (simulado)" });
  if (a === "me" && b === "permissions") return list(["ads_management", "ads_read", "business_management", "pages_show_list", "pages_read_engagement", "pages_manage_ads", "leads_retrieval", "whatsapp_business_management", "read_insights"].map((permission) => ({ permission, status: "granted" })));
  if (a === "debug_token") return ok({ data: { app_id: "1", type: "SYSTEM_USER", application: "PMOS", expires_at: 0, data_access_expires_at: 0, is_valid: true, scopes: ["ads_management", "ads_read", "business_management"], granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["400003"] }], user_id: "9001" } });
  if (a === "me" && b === "businesses") return list(all("business").map((x) => project(x, fields)));
  if (a === "me" && b === "adaccounts") return list(all("account").filter((x) => x.id !== "act_100000000000003").map((x) => project(x, fields)));
  if (a === "me" && b === "accounts") return list(all("page").map((p) => ({ id: p.id, name: p.name, access_token: p.access_token })));
  if (a === "search") {
    const type = q.get("type"), qq = (q.get("q") || "").toLowerCase();
    if (type === "adgeolocation") {
      const L = [
        { key: "MX", name: "M\xE9xico", type: "country", country_code: "MX" },
        { key: "CO", name: "Colombia", type: "country", country_code: "CO" },
        { key: "1024", name: "Ciudad de M\xE9xico", type: "region", country_code: "MX", country_name: "M\xE9xico" },
        { key: "1030", name: "Jalisco", type: "region", country_code: "MX", country_name: "M\xE9xico" },
        { key: "1041", name: "Nuevo Le\xF3n", type: "region", country_code: "MX", country_name: "M\xE9xico" },
        { key: "1037", name: "Estado de M\xE9xico", type: "region", country_code: "MX", country_name: "M\xE9xico" },
        { key: "2673660", name: "Guadalajara", type: "city", region: "Jalisco", country_code: "MX", country_name: "M\xE9xico" },
        { key: "2663426", name: "Monterrey", type: "city", region: "Nuevo Le\xF3n", country_code: "MX", country_name: "M\xE9xico" },
        { key: "2673657", name: "Zapopan", type: "city", region: "Jalisco", country_code: "MX", country_name: "M\xE9xico" },
        { key: "350450", name: "Bogot\xE1", type: "city", region: "Bogot\xE1 D.C.", country_code: "CO", country_name: "Colombia" }
      ];
      const types = JSON.parse(q.get("location_types") || "[]");
      return list(L.filter((x) => x.name.toLowerCase().includes(qq) && (!types.length || types.includes(x.type))));
    }
    if (type === "adlocale") return list([{ key: 23, name: "Espa\xF1ol (Todos)" }, { key: 6, name: "Ingl\xE9s (EE. UU.)" }, { key: 24, name: "Ingl\xE9s (Reino Unido)" }].filter((x) => x.name.toLowerCase().includes(qq)));
    if (type === "adinterest") return list([
      { id: "6003139266461", name: "Tecnolog\xEDa", audience_size_lower_bound: 9e7, audience_size_upper_bound: 11e7, path: ["Intereses", "Tecnolog\xEDa"] },
      { id: "6003020834693", name: "Streaming de video", audience_size_lower_bound: 4e7, audience_size_upper_bound: 5e7, path: ["Intereses", "Entretenimiento"] },
      { id: "6003384248805", name: "F\xFAtbol", audience_size_lower_bound: 6e7, audience_size_upper_bound: 7e7, path: ["Intereses", "Deportes"] }
    ].filter((x) => x.name.toLowerCase().includes(qq)));
    return list([]);
  }
  if (a === "dataset_quality") {
    const ds = q.get("dataset_id");
    if (ds === "500002") return fail(100, "Dataset quality metrics are not available for this dataset.");
    return ok({ web: [
      { event_name: "PageView", event_match_quality: { composite_score: 6.1, match_key_feedback: [{ identifier: "email", coverage: { percentage: 12 } }] } },
      { event_name: "Lead", event_match_quality: { composite_score: 8.2, match_key_feedback: [{ identifier: "email", coverage: { percentage: 88 } }, { identifier: "phone", coverage: { percentage: 92 } }] } },
      { event_name: "Purchase", event_match_quality: { composite_score: 7.4, match_key_feedback: [] } }
    ] });
  }
  const o = S.objs.get(String(a));
  if (!o && !String(a).startsWith("act_")) return fail(100, `Unsupported get request. Object with ID '${a}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`, 33);
  if (o?.__type === "business" && b) {
    if (b === "owned_ad_accounts") return list(o.id === "b1" ? all("account", (x) => x.business.id === "b1").map((x) => project(x, fields)) : []);
    if (b === "client_ad_accounts") return list([]);
    if (b === "owned_whatsapp_business_accounts") return list(all("waba", (w) => w.__biz === o.id).map((w) => project(w, fields)));
    if (b === "client_whatsapp_business_accounts") return list(all("waba", (w) => w.__client === o.id).map((w) => project(w, fields)));
    if (b === "owned_product_catalogs") return list(all("catalog", (c) => c.__biz === o.id).map((c) => project(c, fields)));
    return list([]);
  }
  if (o?.__type === "waba") {
    if (b === "phone_numbers") return list(all("phone", (p) => p.__waba === o.id).map((p) => project(p, fields)));
    if (b === "dataset") return o.__dataset ? ok({ data: [{ id: o.__dataset, name: S.objs.get(o.__dataset)?.name }] }) : fail(100, "Esta cuenta de WhatsApp Business no tiene un conjunto de datos. Cr\xE9alo en Events Manager.", 2388093);
  }
  if (o?.__type === "pixel" && b === "stats") {
    const ev = ["PageView", "ViewContent", "Lead", "Contact", "Purchase", "CompleteRegistration", "InitiateCheckout"];
    if (q.get("aggregation") === "event_source") return ok({ data: [{ start_time: daysAgo(0), data: [{ value: "WEB", count: 9e4 }, { value: "SERVER", count: o.id === "500900" ? 4200 : 51e3 }, ...o.id === "500900" ? [{ value: "BUSINESS_MESSAGING", count: 3900 }] : []] }] });
    const stale = o.id === "500002";
    return ok({ data: Array.from({ length: 7 }, (_, d) => ({
      start_time: daysAgo(d + (stale ? 12 : 0)).slice(0, 10) + "T00:00:00+0000",
      data: (o.id === "500900" ? ["Purchase", "Lead", "Contact"] : ev).map((e, i) => ({ value: e, count: Math.round(8e3 / (i + 1) * (0.8 + hash(o.id + e + d) * 0.4)) }))
    })) });
  }
  if (o?.__type === "page") {
    if (b === "leadgen_forms") return list(all("form", (f) => f.__page === o.id).map((f) => project(f, fields)));
    if (!b) {
      if (fields?.includes("access_token") && !auth.includes("page-token")) return ok({ id: o.id, access_token: o.access_token });
      return ok(project(o, fields));
    }
  }
  if (o?.__type === "form" && b === "leads") {
    return list(Array.from({ length: 25 }, (_, i) => ({
      id: "lead" + i,
      created_time: daysAgo(i * 0.7),
      ad_id: all("ad")[i % 5].id,
      form_id: o.id,
      field_data: [{ name: "full_name", values: ["Cliente " + (i + 1)] }, { name: "email", values: [`cliente${i + 1}@correo.com`] }, { name: "phone_number", values: ["+5255" + String(1e7 + i * 7919).slice(0, 8)] }]
    })));
  }
  if (String(a).startsWith("act_")) {
    const acc = S.objs.get(a);
    if (!acc) return fail(100, `Unsupported get request. Object with ID '${a}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`, 33);
    if (acc.account_status !== 1 && method === "POST") return fail(100, "La cuenta publicitaria est\xE1 deshabilitada.", 1487101, "Esta cuenta publicitaria est\xE1 inhabilitada por incumplir las pol\xEDticas.");
    if (!b && method === "GET") return ok(project(acc, fields));
    const filtering = JSON.parse(q.get("filtering") || "[]");
    const st = filtering.find((f) => f.field === "effective_status")?.value;
    const byStatus = (x) => !st || st.includes(x.effective_status);
    if (method === "GET") {
      if (b === "campaigns") return list(all("campaign", (c) => c.account_id === a && byStatus(c)).map((c) => project(c, fields)));
      if (b === "adsets") return list(all("adset", (c) => c.account_id === a && byStatus(c)).map((c) => project(c, fields)));
      if (b === "ads") return list(all("ad", (c) => c.account_id === a && byStatus(c)).map((c) => project(c, fields)));
      if (b === "promote_pages") return list(all("page", (p) => (p.__accounts || []).includes(a)).map((p) => project(p, fields)));
      if (b === "adspixels") return list(all("pixel", (p) => (p.__accounts || []).includes(a)).map((p) => project(p, fields)));
      if (b === "customconversions") return list(all("cc", (c) => c.__account === a).map((c) => project(c, fields)));
      if (b === "customaudiences") return list(all("audience", (c) => c.__account === a).map((c) => project(c, fields)));
      if (b === "saved_audiences") return list(all("saved", (c) => c.__account === a).map((c) => project(c, fields)));
      if (b === "insights") return list(insightsFor(a, q));
      if (b === "generatepreviews") {
        const cr = JSON.parse(q.get("creative") || "{}");
        const spec = cr.object_story_spec;
        if (!cr.object_story_id && !spec?.page_id) return fail(100, "Invalid parameter", 1487390, "Falta la p\xE1gina del creativo.", ["object_story_spec"]);
        if (spec && !spec.link_data && !spec.video_data) return fail(100, "Invalid parameter", 1487390, "El creativo no tiene contenido.", ["object_story_spec"]);
        if (spec?.link_data && !spec.link_data.image_hash && !spec.link_data.picture) return fail(100, "Invalid parameter", 1487390, "Falta la imagen del creativo.", ["image_hash"]);
        return list([{ body: '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=mock" width="540" height="690"></iframe>' }]);
      }
      if (b === "adimages") return list([]);
      return list([]);
    }
    if (method === "POST") {
      const validate = Array.isArray(body.execution_options) && body.execution_options.includes("validate_only");
      if (b === "campaigns") {
        if (!body.name) return fail(100, "Invalid parameter", 1885030, "La campa\xF1a necesita un nombre.", ["name"]);
        if (!OBJECTIVE_BY_KEY[body.objective]) return fail(100, "Invalid parameter", 1885099, "Objetivo no v\xE1lido.", ["objective"]);
        if (body.special_ad_categories === void 0) return fail(100, "(#100) The parameter special_ad_categories is required.");
        if (!body.daily_budget && !body.lifetime_budget && body.is_adset_budget_sharing_enabled === void 0) return fail(100, "Invalid parameter", 4834011, "Indica si los conjuntos comparten presupuesto.", ["is_adset_budget_sharing_enabled"]);
        if (validate) return ok({ success: true });
        const id = newId();
        put({ __type: "campaign", id, account_id: a, ...body, effective_status: body.status, created_time: nowIso(), updated_time: nowIso() });
        return ok({ id });
      }
      if (b === "adsets") {
        const err = validateAdset(a, body);
        if (err) return err;
        if (validate) return ok({ success: true });
        const id = newId();
        put({ __type: "adset", id, account_id: a, ...body, effective_status: body.status, learning_stage_info: { status: "LEARNING" }, created_time: nowIso(), updated_time: nowIso() });
        return ok({ id });
      }
      if (b === "adcreatives") {
        if (!body.object_story_spec && !body.object_story_id) return fail(100, "Invalid parameter", 1487390, "El creativo necesita object_story_spec u object_story_id.", ["object_story_spec"]);
        const id = newId();
        put({ __type: "creative", id, account_id: a, ...body, thumbnail_url: `https://picsum.photos/seed/${id}/120/120` });
        return ok({ id });
      }
      if (b === "ads") {
        const as = S.objs.get(String(body.adset_id));
        if (!as) return fail(100, "Invalid parameter", 1885014, "El conjunto no existe.", ["adset_id"]);
        if (!S.objs.get(String(body.creative?.creative_id))) return fail(100, "Invalid parameter", 1487390, "El creativo no existe.", ["creative"]);
        if (validate) return ok({ success: true });
        const id = newId();
        put({ __type: "ad", id, account_id: a, campaign_id: as.campaign_id, adset_id: as.id, name: body.name, status: body.status, effective_status: body.status === "ACTIVE" ? "PENDING_REVIEW" : "PAUSED", creative: { id: body.creative.creative_id }, created_time: nowIso(), updated_time: nowIso() });
        return ok({ id });
      }
      if (b === "customaudiences") {
        if (!body.name) return fail(100, "Invalid parameter", 1713001, "El p\xFAblico necesita un nombre.");
        if (body.subtype === "CUSTOM" && !body.customer_file_source) return fail(100, "Invalid parameter", 1870053, "Indica customer_file_source para listas de clientes.");
        if (body.subtype === "LOOKALIKE" && (!body.origin_audience_id || !body.lookalike_spec)) return fail(100, "Invalid parameter", 1713003, "Falta el p\xFAblico de origen o lookalike_spec.");
        const id = newId();
        put({
          __type: "audience",
          id,
          __account: a,
          name: body.name,
          subtype: body.subtype,
          description: body.description,
          rule: body.rule,
          lookalike_spec: body.lookalike_spec,
          retention_days: body.retention_days,
          approximate_count_lower_bound: -1,
          approximate_count_upper_bound: -1,
          time_updated: Math.floor(Date.now() / 1e3),
          time_created: Math.floor(Date.now() / 1e3),
          delivery_status: { code: 300, description: "El p\xFAblico se est\xE1 llenando." },
          operation_status: { code: 200, description: "Normal" }
        });
        return ok({ id });
      }
      if (b === "adimages") {
        const h = "h" + Math.floor(Math.random() * 1e12).toString(16);
        return ok({ images: { [body.filename || "img"]: { hash: h, url: "https://picsum.photos/seed/" + h + "/600" } } });
      }
      if (b === "advideos") return ok({ id: newId() });
    }
  }
  if (!o) return fail(100, "Unsupported request.", 33);
  if (method === "GET" && !b) return ok(project(o, fields));
  if (method === "GET" && b === "adsets" && o.__type === "campaign") return list(all("adset", (x) => x.campaign_id === o.id).map((x) => project(x, fields)));
  if (method === "GET" && b === "ads") return list(all("ad", (x) => (o.__type === "campaign" ? x.campaign_id : x.adset_id) === o.id).map((x) => project(x, fields)));
  if (method === "POST" && b === "copies") {
    const nid = newId();
    const suffix = body.rename_options?.rename_suffix || " - Copia";
    const status = body.status_option === "ACTIVE" ? "ACTIVE" : body.status_option === "INHERITED_FROM_SOURCE" ? o.status : "PAUSED";
    const cp = { ...o, id: nid, name: o.name + suffix, status, effective_status: status, created_time: nowIso() };
    if (o.__type === "adset" && body.campaign_id) cp.campaign_id = body.campaign_id;
    if (o.__type === "ad" && body.adset_id) {
      cp.adset_id = body.adset_id;
      cp.campaign_id = S.objs.get(body.adset_id).campaign_id;
    }
    put(cp);
    if (body.deep_copy === true || body.deep_copy === "true") {
      if (o.__type === "campaign") all("adset", (x) => x.campaign_id === o.id).forEach((as) => {
        const aid = newId();
        put({ ...as, id: aid, campaign_id: nid, status, effective_status: status });
        all("ad", (x) => x.adset_id === as.id).forEach((ad) => put({ ...ad, id: newId(), adset_id: aid, campaign_id: nid, status, effective_status: status }));
      });
      if (o.__type === "adset") all("ad", (x) => x.adset_id === o.id).forEach((ad) => put({ ...ad, id: newId(), adset_id: nid, campaign_id: cp.campaign_id, status, effective_status: status }));
    }
    return ok(o.__type === "campaign" ? { copied_campaign_id: nid } : o.__type === "adset" ? { copied_adset_id: nid } : { copied_ad_id: nid });
  }
  if (method === "POST" && !b) {
    if (o.__type === "adset" && body.daily_budget) {
      const camp = S.objs.get(o.campaign_id);
      if (Number(camp.daily_budget) || Number(camp.lifetime_budget)) return fail(100, "Invalid parameter", 1885621, "El conjunto pertenece a una campa\xF1a con presupuesto de campa\xF1a.", ["daily_budget"]);
    }
    if ((o.__type === "campaign" || o.__type === "adset") && body.daily_budget) {
      const acc = S.objs.get(o.account_id);
      if (Number(body.daily_budget) < Number(acc.min_daily_budget)) return fail(100, "Invalid parameter", 1885272, "El presupuesto es menor al m\xEDnimo.", ["daily_budget"]);
    }
    Object.assign(o, body, { updated_time: nowIso() });
    if (body.status) o.effective_status = body.status;
    return ok({ success: true });
  }
  if (method === "DELETE") {
    S.objs.delete(o.id);
    return ok({ success: true });
  }
  return fail(100, "Unsupported request.", 33);
}

// server/auth/domain.ts
function checkCorporateEmail(claims, allowed, requireHd) {
  const email = String(claims.email || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1) : "";
  const list2 = allowed.map((d) => d.toLowerCase().replace(/^@/, ""));
  if (!email || at <= 0 || !domain) return { ok: false, domain, reason: "Google no entreg\xF3 un correo v\xE1lido." };
  if (!(claims.email_verified === true || claims.email_verified === "true")) return { ok: false, domain, reason: "El correo no est\xE1 verificado por Google." };
  if (!list2.includes(domain)) return { ok: false, domain, reason: `El dominio @${domain} no tiene autorizaci\xF3n para acceder. Solo se permiten cuentas ${list2.map((d) => "@" + d).join(" y ")}.` };
  if (requireHd) {
    const hd = String(claims.hd || "").toLowerCase();
    if (!hd) return { ok: false, domain, reason: "La cuenta no pertenece a Google Workspace corporativo (es una cuenta personal de Google con correo del dominio)." };
    if (!list2.includes(hd)) return { ok: false, domain, reason: `La cuenta pertenece al Workspace @${hd}, que no tiene autorizaci\xF3n.` };
  }
  return { ok: true, domain };
}

// node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var strictDecoder = new TextDecoder("utf-8", { fatal: true });
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0), buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers)
    buf.set(buffer, i), i += buffer.length;
  return buf;
}
var NON_ASCII = /[^\x00-\x7f]/;
function encode(string) {
  if (typeof string == "string" && string.length >= 128) {
    if (NON_ASCII.test(string))
      throw new TypeError("non-ASCII string encountered in encode()");
    return encoder.encode(string);
  }
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127)
      throw new TypeError("non-ASCII string encountered in encode()");
    bytes[i] = code;
  }
  return bytes;
}
function decodeBase64(encoded, url = false) {
  if (Uint8Array.fromBase64)
    return Uint8Array.fromBase64(encoded, { alphabet: url ? "base64url" : "base64" });
  if (url) {
    if (encoded.includes("+") || encoded.includes("/"))
      throw new TypeError("Invalid base64url");
    encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  }
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options), this.name = this.constructor.name, Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWKSInvalid = class extends JOSEError {
  static code = "ERR_JWKS_INVALID";
  code = "ERR_JWKS_INVALID";
};
var JWKSNoMatchingKey = class extends JOSEError {
  static code = "ERR_JWKS_NO_MATCHING_KEY";
  code = "ERR_JWKS_NO_MATCHING_KEY";
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSMultipleMatchingKeys = class extends JOSEError {
  [Symbol.asyncIterator] = async function* () {
  };
  static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSTimeout = class extends JOSEError {
  static code = "ERR_JWKS_TIMEOUT";
  code = "ERR_JWKS_TIMEOUT";
  constructor(message2 = "request timed out", options) {
    super(message2, options);
  }
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// node_modules/jose/dist/webapi/util/base64url.js
var invalid = "The input to be decoded is not correctly encoded.";
function decode(input) {
  try {
    return decodeBase64(typeof input == "string" ? input : decoder.decode(input), true);
  } catch (cause) {
    throw new TypeError(invalid, { cause });
  }
}

// node_modules/jose/dist/webapi/lib/validate.js
function isObject(input) {
  if (typeof input != "object" || input === null || Object.prototype.toString.call(input) !== "[object Object]")
    return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
function isJwkSet(input) {
  return isObject(input) && Array.isArray(input.keys) && Array.from(input.keys).every(isObject);
}
function isDisjoint(...headers) {
  const parameters = /* @__PURE__ */ new Set();
  for (const header of headers)
    if (header)
      for (const parameter of Object.keys(header)) {
        if (parameters.has(parameter))
          return false;
        parameters.add(parameter);
      }
  return true;
}
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label}`);
  }
}
function encodeBase64url(value, label, ErrorClass) {
  try {
    return encode(value);
  } catch {
    throw new ErrorClass(`The ${label} is not a valid base64url string`);
  }
}
function parseJoseHeader(b64, ErrorClass, message2) {
  let parsed;
  try {
    parsed = JSON.parse(strictDecoder.decode(decode(b64)));
  } catch {
    throw new ErrorClass(message2);
  }
  if (!isObject(parsed))
    throw new ErrorClass(message2);
  return parsed;
}
var JWS_RECOGNIZED = { __proto__: null, b64: true };
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s != "string")))
    throw new TypeError(`"${option}" option must be an array of strings`);
  return algorithms === void 0 ? void 0 : new Set(algorithms);
}
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0)
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  if (!protectedHeader || protectedHeader.crit === void 0)
    return [];
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input != "string" || input.length === 0))
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  const recognized = recognizedOption === void 0 ? recognizedDefault : { __proto__: null, ...recognizedOption, ...recognizedDefault };
  for (const parameter of protectedHeader.crit) {
    if (!(parameter in recognized))
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    if (!Object.hasOwn(joseHeader, parameter) || joseHeader[parameter] === void 0)
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    if (recognized[parameter] && (!Object.hasOwn(protectedHeader, parameter) || protectedHeader[parameter] === void 0))
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
  }
  return protectedHeader.crit;
}
function validateB64(protectedHeader, extensions) {
  if (extensions.includes("b64")) {
    const b64 = protectedHeader.b64;
    if (typeof b64 != "boolean")
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    return b64;
  }
  return true;
}

// node_modules/jose/dist/webapi/lib/key.js
var tag = (key2) => key2[Symbol.toStringTag];
var jwkMatchesOp = (entry, key2, usage) => {
  const { alg } = entry;
  if (key2.use !== void 0) {
    const expected = usage === "sign" || usage === "verify" ? "sig" : "enc";
    if (key2.use !== expected)
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
  }
  if (key2.alg !== void 0 && key2.alg !== alg)
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  if (Array.isArray(key2.key_ops)) {
    const expectedKeyOp = usage === "encrypt" || usage === "decrypt" ? entry.ops?.[usage === "encrypt" ? 0 : 1] : usage;
    if (expectedKeyOp && !key2.key_ops.includes(expectedKeyOp))
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
  }
};
async function prepareKey(entry, key2, usage) {
  const { alg, secret } = entry, privateKey = usage === "decrypt" || usage === "sign";
  if (secret && key2 instanceof Uint8Array)
    return key2;
  let normalized, keyObject;
  if (isObject(key2)) {
    if (normalized = normalizeJwk(key2), typeof normalized.kty != "string")
      throw invalidKeyType(alg, key2, secret);
    if (!(secret ? normalized.kty === "oct" && typeof normalized.k == "string" : normalized.kty !== "oct" && (privateKey ? normalized.kty === "AKP" && typeof normalized.priv == "string" || typeof normalized.d == "string" : normalized.d === void 0 && normalized.priv === void 0)))
      throw new TypeError(secret ? 'JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present' : `JSON Web Key for this operation must be a ${privateKey ? "private" : "public"} JWK`);
    if (jwkMatchesOp(entry, normalized, usage), normalized.kty === "oct")
      return decode(normalized.k);
    if (!Object.isFrozen(key2)) {
      const { key_ops } = key2;
      Array.isArray(key_ops) && Object.freeze(key_ops), Object.freeze(key2);
    }
  } else {
    if (!isKeyLike(key2))
      throw invalidKeyType(alg, key2, secret);
    const expectedType = secret ? "secret" : privateKey ? "private" : "public";
    if (key2.type !== expectedType && (secret || ["secret", "public", "private"].includes(key2.type)))
      throw new TypeError(`${tag(key2)} instances must be of type "${expectedType}" for the ${alg} algorithm`);
    if (isCryptoKey(key2))
      return key2;
    if (keyObject = key2, keyObject.type === "secret")
      return keyObject.export();
  }
  cache ||= /* @__PURE__ */ new WeakMap();
  const cacheKey = key2;
  let cached2 = cache.get(cacheKey);
  if (cached2?.[alg])
    return cached2[alg];
  if (cached2 || cache.set(cacheKey, cached2 = {}), keyObject && typeof keyObject.toCryptoKey == "function") {
    const isPublic = keyObject.type === "public", crv = nist[keyObject.asymmetricKeyDetails?.namedCurve], params = entry.resolve?.({ crv, asymmetricKeyType: keyObject.asymmetricKeyType }) ?? entry.subtle;
    return cached2[alg] = keyObject.toCryptoKey(params, isPublic, entry.usages[isPublic ? 0 : 1]);
  }
  return normalized ??= keyObject.export({ format: "jwk" }), normalized.alg = alg, cached2[alg] = await jwkToKey(entry, normalized);
}
var cache;
var nist = {
  __proto__: null,
  prime256v1: "P-256",
  secp384r1: "P-384",
  secp521r1: "P-521"
};
var isCryptoKey = (key2) => {
  if (key2?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key2 instanceof CryptoKey;
  } catch {
    return false;
  }
};
var isKeyObject = (key2) => key2?.[Symbol.toStringTag] === "KeyObject";
var isKeyLike = (key2) => isCryptoKey(key2) || isKeyObject(key2);
function message(msg, actual, ...types) {
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else types.length === 2 ? msg += `one of type ${types[0]} or ${types[1]}.` : msg += `of type ${types[0]}.`;
  return actual == null ? msg += ` Received ${actual}` : typeof actual == "function" && actual.name ? msg += ` Received function ${actual.name}` : typeof actual == "object" && actual != null && actual.constructor?.name && (msg += ` Received an instance of ${actual.constructor.name}`), msg;
}
function invalidKeyType(alg, actual, secret) {
  const types = ["CryptoKey", "KeyObject", "JSON Web Key"];
  return secret && types.push("Uint8Array"), new TypeError(message(`Key for the ${alg} algorithm must be `, actual, ...types));
}
var unusable = (name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
function checkUsage(key2, usage) {
  if (usage && !key2.usages.includes(usage))
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
}
function checkModulusLength(alg, key2) {
  const { modulusLength } = key2.algorithm;
  if (typeof modulusLength != "number" || modulusLength < 2048)
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
}
function checkCryptoKey(key2, expected, usage) {
  const algorithm = key2.algorithm;
  if (algorithm.name !== expected.name)
    throw unusable(expected.name);
  if (expected.hash && algorithm.hash?.name !== expected.hash)
    throw unusable(expected.hash, "algorithm.hash");
  if (expected.namedCurve && algorithm.namedCurve !== expected.namedCurve)
    throw unusable(expected.namedCurve, "algorithm.namedCurve");
  if (expected.length !== void 0 && algorithm.length !== expected.length)
    throw unusable(expected.length, "algorithm.length");
  checkUsage(key2, usage);
}
function snapshotJwk(jwk) {
  return { __proto__: null, ...jwk };
}
function normalizeJwk(jwk) {
  const normalized = snapshotJwk(jwk);
  if (normalized.ext !== void 0 && typeof normalized.ext != "boolean")
    throw new TypeError('"ext" (Extractable) Parameter must be a boolean');
  if (normalized.key_ops !== void 0) {
    const value = normalized.key_ops, keyOps = Array.isArray(value) ? [...value] : void 0;
    if (!keyOps || keyOps.some((operation) => typeof operation != "string") || new Set(keyOps).size !== keyOps.length)
      throw new TypeError('"key_ops" (Key Operations) Parameter must be an array of unique strings');
    normalized.key_ops = keyOps;
  }
  return normalized;
}
async function jwkToKey(entry, jwk, extractable) {
  if (!entry.kty.includes(jwk.kty))
    throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
  const algorithm = entry.resolve?.({ kty: jwk.kty, crv: jwk.crv }) ?? entry.subtle, isPrivate = !!(jwk.d || jwk.priv), keyData = { ...jwk, ext: extractable ?? jwk.ext };
  return keyData.kty !== "AKP" && delete keyData.alg, delete keyData.use, crypto.subtle.importKey("jwk", keyData, algorithm, keyData.ext ?? !isPrivate, jwk.key_ops ?? entry.usages[isPrivate ? 1 : 0]);
}
async function rawKey(key2, expected, usage, extractable = false) {
  return key2 instanceof Uint8Array && (key2 = await crypto.subtle.importKey("raw", key2, expected, extractable, [usage])), checkCryptoKey(key2, expected, usage), key2;
}

// node_modules/jose/dist/webapi/lib/key_descriptor.js
function table(entries) {
  const out = { __proto__: null };
  for (const alg in entries)
    out[alg] = { ...entries[alg], alg };
  return out;
}

// node_modules/jose/dist/webapi/lib/jws_algorithms.js
var sig = [["verify"], ["sign"]];
function hmac(bits) {
  const subtle = { name: "HMAC", hash: `SHA-${bits}` };
  return { kty: ["oct"], secret: true, subtle, signing: subtle, usages: sig };
}
function rsa(bits, saltLength) {
  const subtle = { name: saltLength ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: `SHA-${bits}` };
  return {
    kty: ["RSA"],
    subtle,
    signing: saltLength ? { ...subtle, saltLength } : subtle,
    usages: sig,
    minRsaBits: 2048
  };
}
function ecdsa(crv, bits) {
  return {
    kty: ["EC"],
    crv,
    subtle: { name: "ECDSA", namedCurve: crv },
    signing: { name: "ECDSA", hash: `SHA-${bits}` },
    usages: sig
  };
}
function eddsa() {
  const subtle = { name: "Ed25519" };
  return {
    kty: ["OKP"],
    crv: "Ed25519",
    subtle,
    signing: subtle,
    usages: sig
  };
}
function mldsa(bits) {
  const subtle = { name: `ML-DSA-${bits}` };
  return {
    kty: ["AKP"],
    subtle,
    signing: subtle,
    usages: sig
  };
}
var JWS = table({
  HS256: hmac(256),
  HS384: hmac(384),
  HS512: hmac(512),
  RS256: rsa(256),
  RS384: rsa(384),
  RS512: rsa(512),
  PS256: rsa(256, 32),
  PS384: rsa(384, 48),
  PS512: rsa(512, 64),
  ES256: ecdsa("P-256", 256),
  ES384: ecdsa("P-384", 384),
  ES512: ecdsa("P-521", 512),
  EdDSA: eddsa(),
  Ed25519: eddsa(),
  "ML-DSA-44": mldsa(44),
  "ML-DSA-65": mldsa(65),
  "ML-DSA-87": mldsa(87)
});
function jwsAlgorithm(alg) {
  const entry = typeof alg == "string" ? JWS[alg] : void 0;
  if (!entry)
    throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  return entry;
}

// node_modules/jose/dist/webapi/lib/jws_verify.js
function prepareVerify(options) {
  return [options && validateAlgorithms("algorithms", options.algorithms), options?.crit];
}
function parseProtectedHeader(encodedProtected) {
  return encodedProtected === void 0 ? {} : parseJoseHeader(encodedProtected, JWSInvalid, "JWS Protected Header is invalid");
}
function encodeCompactUnencodedPayload(payload) {
  try {
    return encode(payload);
  } catch {
    throw new JWSInvalid("JWS Compact Serialization payload must use only ASCII characters");
  }
}
async function verifySignature(jws, shared, key2, encodeUnencodedPayload, parsedProtected) {
  const { protected: encodedProtected, header, payload: inputPayload } = jws, parsedProt = parsedProtected ?? parseProtectedHeader(encodedProtected);
  if (!isDisjoint(parsedProt, header))
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  const joseHeader = { ...parsedProt, ...header }, b64 = validateB64(parsedProt, validateCrit(JWSInvalid, JWS_RECOGNIZED, shared[1], parsedProt, joseHeader)), { alg } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  if (shared[0] && !shared[0].has(alg))
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  if (b64) {
    if (typeof inputPayload != "string")
      throw new JWSInvalid("JWS Payload must be a string");
  } else if (typeof inputPayload != "string" && !(inputPayload instanceof Uint8Array))
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  const signingPayload = b64 || typeof inputPayload != "string" ? inputPayload : encodeUnencodedPayload(inputPayload);
  let resolvedKey = false;
  typeof key2 == "function" && (key2 = await key2(parsedProt, jws), resolvedKey = true);
  const entry = jwsAlgorithm(alg), data = concat(encodedProtected !== void 0 ? encode(encodedProtected) : new Uint8Array(), encode("."), typeof signingPayload == "string" ? shared[2] ??= encodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload), signature = decodeBase64url(jws.signature, "signature", JWSInvalid), k = await prepareKey(entry, key2, "verify"), cryptoKey = await rawKey(k, entry.subtle, "verify");
  entry.minRsaBits && checkModulusLength(entry.alg, cryptoKey);
  let verified = false;
  try {
    verified = await crypto.subtle.verify(entry.signing, cryptoKey, signature, data);
  } catch {
  }
  if (!verified)
    throw new JWSSignatureVerificationFailed();
  const result = { payload: typeof signingPayload == "string" ? decodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload };
  return encodedProtected !== void 0 && (result.protectedHeader = parsedProt), header !== void 0 && (result.unprotectedHeader = header), resolvedKey ? [{ ...result, key: k }, b64] : [result, b64];
}
async function verifyCompact(jws, shared, key2) {
  if (jws instanceof Uint8Array && (jws = decoder.decode(jws)), typeof jws != "string")
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3)
    throw new JWSInvalid("Invalid Compact JWS");
  return verifySignature({ payload, protected: protectedHeader, signature }, shared, key2, encodeCompactUnencodedPayload);
}

// node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = (date) => Math.floor(date.getTime() / 1e3);
var multipliers = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31557600
};
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var checkFailed = "check_failed";
function invalidDuration() {
  throw new TypeError("Invalid time period format");
}
function secs(str) {
  typeof str != "string" && invalidDuration();
  const matched = REGEX.exec(str);
  (!matched || matched[4] && matched[1]) && invalidDuration();
  const value = parseFloat(matched[2]), numericDate2 = Math.round(value * multipliers[matched[3][0].toLowerCase()]);
  return Number.isFinite(numericDate2) || invalidDuration(), matched[1] === "-" || matched[4] === "ago" ? -numericDate2 : numericDate2;
}
function validateInput(label, input) {
  if (!Number.isFinite(input))
    throw new TypeError(`Invalid ${label} input`);
  return input;
}
var normalizeTyp = (value) => {
  const normalized = value.toLowerCase();
  return value.includes("/") ? normalized : `application/${normalized}`;
};
var checkAudiencePresence = (audPayload, audOption) => typeof audPayload == "string" ? audOption.includes(audPayload) : Array.isArray(audPayload) ? audOption.some((aud) => audPayload.includes(aud)) : false;
function validateNumericDate(payload, claim, required = false) {
  const value = payload[claim];
  if (!(value === void 0 && !required)) {
    if (typeof value != "number")
      throw new JWTClaimValidationFailed(`"${claim}" claim must be a number`, payload, claim, "invalid");
    return value;
  }
}
function unexpectedClaim(payload, claim) {
  throw new JWTClaimValidationFailed(`unexpected "${claim}" claim value`, payload, claim, checkFailed);
}
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(strictDecoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload))
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  const { typ } = options;
  if (typ !== void 0 && (typeof protectedHeader.typ != "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ)))
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", checkFailed);
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options, presenceCheck = [...requiredClaims];
  maxTokenAge !== void 0 && presenceCheck.push("iat"), audience !== void 0 && presenceCheck.push("aud"), subject !== void 0 && presenceCheck.push("sub"), issuer !== void 0 && presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse()))
    if (!Object.hasOwn(payload, claim))
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
  issuer !== void 0 && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss) && unexpectedClaim(payload, "iss"), subject !== void 0 && payload.sub !== subject && unexpectedClaim(payload, "sub"), audience !== void 0 && !checkAudiencePresence(payload.aud, typeof audience == "string" ? [audience] : audience) && unexpectedClaim(payload, "aud");
  const { clockTolerance } = options;
  let tolerance = 0;
  if (typeof clockTolerance == "string")
    tolerance = secs(clockTolerance);
  else if (clockTolerance !== void 0) {
    if (typeof clockTolerance != "number")
      throw new TypeError("Invalid clockTolerance option type");
    tolerance = clockTolerance;
  }
  validateInput("clockTolerance option", tolerance);
  const { currentDate } = options, now = validateInput("currentDate option", epoch(currentDate === void 0 ? /* @__PURE__ */ new Date() : currentDate)), iat = validateNumericDate(payload, "iat", maxTokenAge !== void 0), nbf = validateNumericDate(payload, "nbf");
  if (nbf !== void 0 && nbf > now + tolerance)
    throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", checkFailed);
  const exp = validateNumericDate(payload, "exp");
  if (exp !== void 0 && exp <= now - tolerance)
    throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", checkFailed);
  if (maxTokenAge !== void 0) {
    const age = now - iat, max = validateInput("maxTokenAge option", typeof maxTokenAge == "number" ? maxTokenAge : secs(maxTokenAge));
    if (age - tolerance > max)
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", checkFailed);
    if (age < -tolerance)
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", checkFailed);
  }
  return payload;
}

// node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key2, options) {
  const [verified, b64] = await verifyCompact(jwt, prepareVerify(options), key2);
  if (!b64)
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  return { ...verified, payload };
}

// node_modules/jose/dist/webapi/jwks/local.js
function isUsableJWK(jwk, entry, alg, kid) {
  const { kty, key_ops: keyOps, ext, kid: jwkKid, alg: jwkAlg, use, crv } = jwk;
  return (ext === void 0 || typeof ext == "boolean") && (keyOps === void 0 || Array.isArray(keyOps) && keyOps.every((operation, index) => typeof operation == "string" && keyOps.indexOf(operation) === index) && keyOps.includes("verify")) && entry.kty.includes(kty) && (kid === void 0 || typeof kid == "string" && kid === jwkKid) && (jwkAlg === void 0 ? kty !== "AKP" : alg === jwkAlg) && (use === void 0 || use === "sig") && (!entry.crv || crv === entry.crv);
}
async function importWithAlgCache(cache2, jwk, entry) {
  const cached2 = cache2.get(jwk) || cache2.set(jwk, {}).get(jwk), { alg } = entry;
  if (cached2[alg] === void 0) {
    const pending = jwkToKey(entry, jwk, true).then((key2) => {
      if (key2.type !== "public")
        throw new JWKSInvalid("JSON Web Key Set members must be public keys");
      return cached2[alg] = key2, key2;
    }).catch((error) => {
      throw cached2[alg] === pending && delete cached2[alg], error;
    });
    cached2[alg] = pending;
  }
  return cached2[alg];
}
function createLocalJWKSet(jwks) {
  let snapshot;
  try {
    snapshot = structuredClone(jwks);
  } catch {
  }
  if (!isJwkSet(snapshot))
    throw new JWKSInvalid("JSON Web Key Set malformed");
  const metadata = snapshot.keys.map((jwk) => {
    const normalized = snapshotJwk(jwk);
    return Array.isArray(normalized.key_ops) && (normalized.key_ops = [...normalized.key_ops]), normalized;
  }), cached2 = /* @__PURE__ */ new WeakMap();
  return Object.defineProperty(async (protectedHeader, token) => {
    const { alg, kid } = { ...protectedHeader, ...token?.header }, entry = typeof alg == "string" ? JWS[alg] : void 0;
    if (!entry || entry.secret)
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
    const candidates = snapshot.keys.filter((_, index) => isUsableJWK(metadata[index], entry, alg, kid)), { 0: jwk, length } = candidates;
    if (!length)
      throw new JWKSNoMatchingKey();
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys();
      throw error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates)
          try {
            yield await importWithAlgCache(cached2, jwk2, entry);
          } catch {
          }
      }, error;
    }
    return importWithAlgCache(cached2, jwk, entry);
  }, "jwks", {
    value: () => structuredClone(snapshot)
  });
}

// node_modules/jose/dist/webapi/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair < "u" || typeof navigator < "u" && navigator.userAgent === "Cloudflare-Workers" || typeof EdgeRuntime < "u" && EdgeRuntime === "vercel";
}
var USER_AGENT;
(typeof navigator > "u" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) && (USER_AGENT = "jose/v6.2.12");
var customFetch = /* @__PURE__ */ Symbol();
async function fetchJwks(url, headers, signal, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    redirect: "manual",
    headers
  }).catch((err) => {
    throw err.name === "TimeoutError" ? new JWKSTimeout() : err;
  });
  if (response.status !== 200)
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  try {
    return await response.json();
  } catch {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
  }
}
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshFor(timestamp, duration) {
  return Number.isFinite(timestamp) && Date.now() < timestamp + duration;
}
function validateDuration(value, fallback, option) {
  if (Number.isNaN(value))
    throw new TypeError(`"${option}" option must not be NaN`);
  return typeof value == "number" ? value : fallback;
}
function createRemoteJWKSet(url, options) {
  if (!(url instanceof URL))
    throw new TypeError("url must be an instance of URL");
  const href = new URL(url.href).href, opts = options ?? {}, timeoutOption = opts.timeoutDuration;
  if (typeof timeoutOption == "number" && (!Number.isInteger(timeoutOption) || timeoutOption < 0))
    throw new TypeError('"timeoutDuration" option must be a non-negative integer');
  const timeoutDuration = typeof timeoutOption == "number" ? timeoutOption : 5e3, cooldownDuration = validateDuration(opts.cooldownDuration, 3e4, "cooldownDuration"), cacheMaxAge = validateDuration(opts.cacheMaxAge, 6e5, "cacheMaxAge"), headers = new Headers(opts.headers);
  USER_AGENT && !headers.has("User-Agent") && headers.set("User-Agent", USER_AGENT), headers.has("accept") || headers.set("accept", "application/json, application/jwk-set+json");
  const fetchImpl = opts[customFetch], cache2 = opts[jwksCache];
  let jwksTimestamp, pendingFetch, reloadSequence = 0, appliedSequence = 0, local;
  if (cache2 && typeof cache2 == "object") {
    const { uat, jwks } = cache2;
    isFreshFor(uat, cacheMaxAge) && isJwkSet(jwks) && (jwksTimestamp = uat, local = createLocalJWKSet(jwks));
  }
  const reload = async () => {
    if (pendingFetch && isCloudflareWorkers() && (pendingFetch = void 0), !pendingFetch) {
      const sequence = ++reloadSequence, current = pendingFetch = fetchJwks(href, headers, AbortSignal.timeout(timeoutDuration), fetchImpl).then((json2) => {
        const next = createLocalJWKSet(json2);
        if (sequence <= appliedSequence)
          return;
        local = next;
        const updatedAt = Date.now();
        cache2 && (cache2.uat = updatedAt, cache2.jwks = json2), jwksTimestamp = updatedAt, appliedSequence = sequence;
      }).finally(() => {
        pendingFetch === current && (pendingFetch = void 0);
      });
    }
    await pendingFetch;
  };
  return Object.defineProperties(async (protectedHeader, token) => {
    (!local || !isFreshFor(jwksTimestamp, cacheMaxAge)) && await reload();
    try {
      return await local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey && !isFreshFor(jwksTimestamp, cooldownDuration))
        return await reload(), local(protectedHeader, token);
      throw err;
    }
  }, {
    coolingDown: {
      get: () => isFreshFor(jwksTimestamp, cooldownDuration),
      enumerable: true
    },
    fresh: {
      get: () => isFreshFor(jwksTimestamp, cacheMaxAge),
      enumerable: true
    },
    reload: {
      value: reload,
      enumerable: true
    },
    reloading: {
      get: () => !!pendingFetch,
      enumerable: true
    },
    jwks: {
      value: () => local?.jwks(),
      enumerable: true
    }
  });
}

// server/auth/google.ts
init_env();
init_crypto();
var JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
var STATE_COOKIE = "pmos_oauth";
async function pkce() {
  const verifier = randomId(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(digest).toString("base64url") };
}
async function startGoogleLogin(returnTo = "/") {
  if (!env.googleClientId) throw new ApiError(500, "Google OAuth no est\xE1 configurado (GOOGLE_CLIENT_ID).", "config");
  const state = randomId(24), nonce = randomId(24);
  const { verifier, challenge } = await pkce();
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  const sealed = await sign({ state, nonce, verifier, returnTo: safeReturn, exp: Date.now() + 10 * 60 * 1e3 }, "oauth");
  const p = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.appUrl + "/api/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    /* Sugerencia de dominio para el selector de cuentas (no es una barrera: la barrera es el servidor). */
    hd: env.allowedDomains.length === 1 ? env.allowedDomains[0] : "*"
  });
  return { url: "https://accounts.google.com/o/oauth2/v2/auth?" + p, cookie: cookie(STATE_COOKIE, sealed, { maxAge: 600, path: "/api/auth" }) };
}
async function finishGoogleLogin(req, url) {
  const err = url.searchParams.get("error");
  if (err) throw new ApiError(400, err === "access_denied" ? "Cancelaste el inicio de sesi\xF3n con Google." : "Google devolvi\xF3 un error: " + err, "google_error");
  const sealed = parseCookies(req.headers.get("cookie"))[STATE_COOKIE];
  const st = sealed ? await verify(sealed, "oauth") : null;
  if (!st || st.exp < Date.now()) throw new ApiError(400, "La solicitud de inicio de sesi\xF3n venci\xF3. Vuelve a intentarlo.", "state_expired");
  if (url.searchParams.get("state") !== st.state) throw new ApiError(400, "La respuesta de Google no coincide con la solicitud (state).", "state_mismatch");
  const code = url.searchParams.get("code");
  if (!code) throw new ApiError(400, "Google no devolvi\xF3 el c\xF3digo de autorizaci\xF3n.", "no_code");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.appUrl + "/api/auth/google/callback",
      grant_type: "authorization_code",
      code_verifier: st.verifier
    })
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) throw new ApiError(502, "No se pudo completar el inicio de sesi\xF3n con Google: " + (tok.error_description || tok.error || r.status), "token_exchange");
  const { payload } = await jwtVerify(tok.id_token, JWKS, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: env.googleClientId });
  if (payload.nonce !== st.nonce) throw new ApiError(400, "El token de Google no corresponde a esta solicitud (nonce).", "nonce");
  return { claims: payload, returnTo: st.returnTo };
}
function clearStateCookie() {
  return cookie(STATE_COOKIE, "", { maxAge: 0, path: "/api/auth" });
}

// server/routes/auth.ts
init_env();

// server/lib/audit.ts
init_crypto();
init_store();
async function audit(e) {
  const at = e.at || (/* @__PURE__ */ new Date()).toISOString();
  const entry = { ...e, at, id: at.replace(/[-:.TZ]/g, "") + "-" + randomId(6) };
  await kv("audit").set("log/" + at.slice(0, 10) + "/" + entry.id, entry).catch((err) => console.error("[audit] no se pudo guardar", err));
  if (e.action.startsWith("auth.")) await kv("audit").set("access/" + at.slice(0, 10) + "/" + entry.id, entry).catch(() => void 0);
  console.log("[audit]", JSON.stringify({ at, user: e.user, action: e.action, entity: e.entityId, result: e.result, error: e.error }));
  return entry;
}
async function queryAudit(q) {
  const kind = q.kind || "log";
  const to = q.to || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const from = q.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const keys = (await kv("audit").list(kind + "/")).filter((k) => {
    const d = k.split("/")[1];
    return d >= from && d <= to;
  }).reverse();
  const out = [];
  const limit = Math.min(q.limit || 300, 2e3);
  for (let i = 0; i < keys.length && out.length < limit; i += 50) {
    const batch = await Promise.all(keys.slice(i, i + 50).map((k) => kv("audit").get(k)));
    for (const e of batch) {
      if (!e) continue;
      if (q.user && e.user !== q.user) continue;
      if (q.accountId && e.accountId !== q.accountId) continue;
      if (q.action && !e.action.startsWith(q.action)) continue;
      if (q.q && !JSON.stringify(e).toLowerCase().includes(q.q.toLowerCase())) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// server/routes/auth.ts
init_store();
function registerAuth(r) {
  r.get("/api/health", () => ({
    ok: configProblems().length === 0,
    problems: configProblems(),
    version: "6.0.0",
    metaMode: env.metaMode,
    metaVersion: env.metaVersion,
    devLogin: env.devLogin,
    allowedDomains: env.allowedDomains,
    googleConfigured: !!(env.googleClientId && env.googleClientSecret),
    codeLogin: env.accessCode.length >= 10,
    metaOAuth: !!(env.metaAppId && env.metaAppSecret),
    motorConfigured: !!(env.motorUrl && env.motorSecret)
  }), { auth: false });
  r.get("/api/auth/google/start", async (ctx) => {
    const { url, cookie: cookie2 } = await startGoogleLogin(ctx.url.searchParams.get("returnTo") || "/");
    return redirect(url, [cookie2]);
  }, { auth: false });
  r.get("/api/auth/google/callback", async (ctx) => {
    const ua = ctx.req.headers.get("user-agent") || "";
    try {
      const { claims, returnTo } = await finishGoogleLogin(ctx.req, ctx.url);
      const check = checkCorporateEmail(claims, env.allowedDomains, env.requireHd);
      if (!check.ok) {
        await audit({ user: String(claims.email || "desconocido"), action: "auth.denied", result: "error", error: check.reason, ip: ctx.ip, level: "session", meta: { hd: claims.hd || null } });
        return redirect("/login?error=" + encodeURIComponent(check.reason || "Acceso no autorizado.") + "&email=" + encodeURIComponent(claims.email || ""), [clearStateCookie()]);
      }
      const user = await upsertOnLogin({ email: claims.email, name: claims.name || claims.email, picture: claims.picture, domain: check.domain });
      if (!user.active) {
        await audit({ user: user.email, action: "auth.denied", result: "error", error: "Usuario desactivado", ip: ctx.ip, level: "session" });
        return redirect("/login?error=" + encodeURIComponent("Tu usuario est\xE1 desactivado. Pide acceso a un administrador."), [clearStateCookie()]);
      }
      const s = await createSession(user.email, ctx.ip, ua);
      await audit({ user: user.email, action: "auth.login", result: "ok", ip: ctx.ip, level: "session", meta: { role: user.role, method: "google", ua: ua.slice(0, 120) } });
      return redirect(returnTo || "/", [s.cookie, clearStateCookie()]);
    } catch (e) {
      await audit({ user: "desconocido", action: "auth.error", result: "error", error: String(e.message || e), ip: ctx.ip, level: "session" });
      return redirect("/login?error=" + encodeURIComponent(e instanceof ApiError ? e.message : "No se pudo iniciar sesi\xF3n con Google: " + String(e.message || e)), [clearStateCookie()]);
    }
  }, { auth: false });
  r.post("/api/auth/code-login", async (ctx) => {
    if (env.accessCode.length < 10) throw new ApiError(404, "El ingreso con c\xF3digo no est\xE1 habilitado.");
    const key2 = "loginfail/" + (ctx.ip || "sin-ip").replace(/[^a-zA-Z0-9.:]/g, "_");
    const fails = await kv("core").get(key2) || { n: 0, until: 0 };
    if (fails.until > Date.now()) throw new ApiError(429, "Demasiados intentos fallidos. Espera 15 minutos.", "locked");
    const { email, code } = await ctx.json();
    const mail = String(email || "").trim().toLowerCase();
    const check = checkCorporateEmail({ email: mail, email_verified: true, hd: mail.split("@")[1] }, env.allowedDomains, false);
    const okCode = typeof code === "string" && code.length === env.accessCode.length && [...code].reduce((d, ch, i) => d | ch.charCodeAt(0) ^ env.accessCode.charCodeAt(i), 0) === 0;
    if (!check.ok || !okCode) {
      const n2 = fails.n + 1;
      await kv("core").set(key2, { n: n2 >= 5 ? 0 : n2, until: n2 >= 5 ? Date.now() + 15 * 6e4 : 0 });
      await audit({ user: mail || "desconocido", action: "auth.denied", result: "error", error: !check.ok ? check.reason : "C\xF3digo incorrecto", ip: ctx.ip, level: "session", meta: { method: "code" } });
      throw new ApiError(403, !check.ok ? check.reason : "El c\xF3digo de acceso no es correcto.", !check.ok ? "domain" : "code");
    }
    await kv("core").del(key2);
    const user = await upsertOnLogin({ email: mail, name: mail.split("@")[0], domain: check.domain });
    if (!user.active) throw new ApiError(403, "Tu usuario est\xE1 desactivado. Pide acceso a un administrador.");
    const s = await createSession(user.email, ctx.ip, ctx.req.headers.get("user-agent") || "");
    ctx.setCookies.push(s.cookie);
    await audit({ user: user.email, action: "auth.login", result: "ok", ip: ctx.ip, level: "session", meta: { method: "code", role: user.role } });
    return { ok: true };
  }, { auth: false });
  r.post("/api/auth/dev-login", async (ctx) => {
    if (!env.devLogin) throw new ApiError(404, "No disponible.");
    const { email, name } = await ctx.json();
    const check = checkCorporateEmail({ email, email_verified: true, hd: String(email || "").split("@")[1] }, env.allowedDomains, env.requireHd);
    if (!check.ok) {
      await audit({ user: String(email), action: "auth.denied", result: "error", error: check.reason, ip: ctx.ip, level: "session", meta: { method: "dev" } });
      throw new ApiError(403, check.reason || "Acceso no autorizado.", "domain");
    }
    const user = await upsertOnLogin({ email, name: name || email.split("@")[0], domain: check.domain });
    const s = await createSession(user.email, ctx.ip, ctx.req.headers.get("user-agent") || "");
    ctx.setCookies.push(s.cookie);
    await audit({ user: user.email, action: "auth.login", result: "ok", ip: ctx.ip, level: "session", meta: { method: "dev" } });
    return { ok: true };
  }, { auth: false });
  r.get("/api/auth/me", async (ctx) => {
    const s = await readSession(ctx.req);
    if (!s) throw new ApiError(401, "Sin sesi\xF3n.", "unauthenticated");
    if (s.refreshCookie) ctx.setCookies.push(s.refreshCookie);
    return { user: s.user, session: { createdAt: s.record.createdAt, expiresAt: s.record.expiresAt, lastSeenAt: s.record.lastSeenAt } };
  }, { auth: false });
  r.post("/api/auth/logout", async (ctx) => {
    if (ctx.sessionId) await revokeSession(ctx.sessionId);
    ctx.setCookies.push(clearSessionCookie());
    await audit({ user: ctx.user.email, action: "auth.logout", result: "ok", ip: ctx.ip, level: "session" });
    return { ok: true };
  });
}

// server/routes/meta.ts
init_env();
init_client();
init_assets();

// server/meta/oauth.ts
init_env();
init_crypto();
init_client();
init_token();
var COOKIE = "pmos_meta_oauth";
async function startMetaLogin(user) {
  if (!env.metaAppId || !env.metaAppSecret) throw new ApiError(400, "Configura META_APP_ID y META_APP_SECRET para conectar Meta con Facebook Login.", "config");
  const state = randomId(24);
  const sealed = await sign({ state, user, exp: Date.now() + 10 * 60 * 1e3 }, "meta-oauth");
  const p = new URLSearchParams({ client_id: env.metaAppId, redirect_uri: env.appUrl + "/api/meta/oauth/callback", state, response_type: "code" });
  if (env.metaLoginConfigId) p.set("config_id", env.metaLoginConfigId);
  else p.set("scope", [...Object.keys(REQUIRED_SCOPES), ...Object.keys(OPTIONAL_SCOPES)].join(","));
  return { url: `https://www.facebook.com/${env.metaVersion}/dialog/oauth?` + p, cookie: cookie(COOKIE, sealed, { maxAge: 600, path: "/api/meta" }) };
}
async function finishMetaLogin(req, url, sessionEmail) {
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err) throw new ApiError(400, "Meta no autoriz\xF3 la conexi\xF3n: " + err, "meta_denied");
  const st = await verify(parseCookies(req.headers.get("cookie"))[COOKIE] || "", "meta-oauth");
  if (!st || st.exp < Date.now() || st.state !== url.searchParams.get("state")) throw new ApiError(400, "La solicitud de conexi\xF3n con Meta venci\xF3 o no coincide. Vuelve a intentarlo.", "state");
  if (st.user !== sessionEmail) throw new ApiError(403, "La conexi\xF3n la inici\xF3 otro usuario.", "user_mismatch");
  const code = url.searchParams.get("code");
  if (!code) throw new ApiError(400, "Meta no devolvi\xF3 el c\xF3digo de autorizaci\xF3n.", "no_code");
  const app = new Graph(env.metaAppId + "|" + env.metaAppSecret, { label: "oauth" });
  const tok = await app.get("oauth/access_token", { client_id: env.metaAppId, client_secret: env.metaAppSecret, redirect_uri: env.appUrl + "/api/meta/oauth/callback", code });
  let token = tok.access_token;
  let dbg = (await app.get("debug_token", { input_token: token })).data || {};
  if (dbg.type === "USER" && Number(dbg.expires_at) && Number(dbg.expires_at) * 1e3 - Date.now() < 7 * 864e5) {
    const ll = await app.get("oauth/access_token", { grant_type: "fb_exchange_token", client_id: env.metaAppId, client_secret: env.metaAppSecret, fb_exchange_token: token });
    token = ll.access_token;
    dbg = (await app.get("debug_token", { input_token: token })).data || {};
  }
  const me = await new Graph(token).get("me", { fields: "id,name" }).catch(() => ({}));
  const conn = await saveConnection({
    label: `${me.name || "Meta"} \xB7 ${dbg.type === "SYSTEM_USER" ? "system user" : "usuario"}`,
    source: "oauth",
    tokenType: dbg.type,
    metaUserId: me.id,
    metaUserName: me.name,
    scopes: dbg.scopes || [],
    expiresAt: Number(dbg.expires_at) ? Number(dbg.expires_at) * 1e3 : null,
    dataAccessExpiresAt: Number(dbg.data_access_expires_at) ? Number(dbg.data_access_expires_at) * 1e3 : null,
    isDefault: true,
    createdBy: sessionEmail,
    token
  });
  return { connection: conn, clearCookie: cookie(COOKIE, "", { maxAge: 0, path: "/api/meta" }) };
}

// server/routes/meta.ts
init_token();
function registerMeta(r) {
  r.get("/api/meta/health", async () => tokenHealth());
  r.get("/api/meta/connections", async () => ({
    envToken: !!env.metaToken,
    oauthAvailable: !!(env.metaAppId && env.metaAppSecret),
    loginConfig: !!env.metaLoginConfigId,
    connections: (await listConnections()).map((c) => ({ ...c, tokenEnc: void 0, expiresInDays: c.expiresAt ? Math.floor((c.expiresAt - Date.now()) / 864e5) : null }))
  }));
  r.post("/api/meta/oauth/start", async (ctx) => {
    const { url, cookie: cookie2 } = await startMetaLogin(ctx.user.email);
    ctx.setCookies.push(cookie2);
    return { url };
  }, { permission: "meta_connect" });
  r.get("/api/meta/oauth/callback", async (ctx) => {
    const s = await readSession(ctx.req);
    if (!s) return redirect("/login?error=" + encodeURIComponent("Inicia sesi\xF3n antes de conectar Meta."));
    if (!s.user.permissions.includes("meta_connect")) return redirect("/settings/meta?error=" + encodeURIComponent("Tu rol no puede conectar Meta."));
    try {
      const { connection, clearCookie } = await finishMetaLogin(ctx.req, ctx.url, s.user.email);
      resetGraphCache();
      await audit({ user: s.user.email, action: "meta.connect", result: "ok", level: "meta", entityId: connection.id, entityName: connection.label, meta: { scopes: connection.scopes, tokenType: connection.tokenType } });
      return redirect("/settings/meta?connected=1", [clearCookie]);
    } catch (e) {
      await audit({ user: s.user.email, action: "meta.connect", result: "error", level: "meta", error: e.info?.message || e.message });
      return redirect("/settings/meta?error=" + encodeURIComponent(e.info ? `${e.info.message} [${e.info.code}]` : e.message));
    }
  }, { auth: false });
  r.post("/api/meta/connections/:id/default", async (ctx) => {
    await setDefaultConnection(ctx.params.id === "env" ? null : ctx.params.id);
    resetGraphCache();
    await audit({ user: ctx.user.email, action: "meta.connection.default", result: "ok", level: "meta", entityId: ctx.params.id });
    return { ok: true };
  }, { permission: "meta_connect" });
  r.del("/api/meta/connections/:id", async (ctx) => {
    await deleteConnection(ctx.params.id);
    resetGraphCache();
    await audit({ user: ctx.user.email, action: "meta.connection.delete", result: "ok", level: "meta", entityId: ctx.params.id });
    return { ok: true };
  }, { permission: "meta_connect" });
  r.get("/api/meta/errors", async (ctx) => ({ errors: await recentMetaErrors(Number(ctx.url.searchParams.get("days") || 3)) }));
  r.get("/api/meta/check", async (ctx) => {
    const accountId = ctx.url.searchParams.get("accountId");
    if (accountId) await ensureAccountAccess(ctx, accountId);
    const g = await graph();
    const health = await tokenHealth();
    const checks = [...health.checks];
    if (accountId) {
      try {
        const a = await account(g, accountId);
        checks.push({
          group: "Cuenta",
          item: "Estado",
          status: a.status === 1 ? "ok" : "error",
          detail: `"${a.name}" \xB7 ${a.statusLabel}${a.disableReason ? " \xB7 motivo: " + (DISABLE_REASON[a.disableReason] || a.disableReason) : ""} \xB7 ${a.currency} \xB7 ${a.timezone}.`,
          fix: a.status === 1 ? void 0 : "Una cuenta que no est\xE1 activa no admite anuncios ni cambios. Resu\xE9lvelo en Business Support Home o en la configuraci\xF3n de pagos."
        });
        if (a.spendCap) {
          const pct3 = (a.amountSpent || 0) / a.spendCap * 100;
          checks.push({ group: "Cuenta", item: "L\xEDmite de gasto", status: pct3 >= 90 ? "warning" : "ok", detail: `Lleva ${pct3.toFixed(0)} % del l\xEDmite de gasto de la cuenta.`, fix: pct3 >= 90 ? "Sube o quita el l\xEDmite: al alcanzarlo Meta detiene toda la entrega." : void 0 });
        }
        const assets = (await accountAssets(g, accountId, true)).value;
        const waInfo = await whatsappInfo(g, accountId).then((x) => x.value).catch(() => null);
        const waPages = waInfo?.pages || {};
        const waUsed = new Map((waInfo?.datasets || []).filter((d) => d.sources.includes("CONJUNTOS")).map((d) => [d.id, d]));
        const wabaDs = new Set(assets.wabas.flatMap((w) => w.datasets.map((d) => d.id)));
        const nf = (v2) => formatNumber(Number(v2) || 0);
        assets.warnings.forEach((w) => checks.push({ group: "Activos", item: "Lectura parcial", status: "warning", detail: w }));
        checks.push({ group: "P\xE1ginas", item: "P\xE1ginas disponibles", status: assets.pages.length ? "ok" : "error", detail: assets.pages.length ? assets.pages.map((p) => p.name).join(", ") : "La cuenta no tiene p\xE1ginas para anunciar.", fix: assets.pages.length ? void 0 : "Asigna la p\xE1gina al system user y a la cuenta en Business Manager." });
        for (const p of assets.pages.slice(0, 8)) {
          const conf = waPages[p.id];
          const inUse = !!conf?.confirmed;
          checks.push({
            group: "WhatsApp",
            item: `WhatsApp de "${p.name}"`,
            status: p.whatsappNumber || inUse ? "ok" : p.whatsappNumber === "" ? "warning" : "info",
            /* El campo whatsapp_number de la p\xE1gina solo refleja algunos tipos de v\xEDnculo (p. ej. la app de WhatsApp Business).
               Con n\xFAmeros de la API en la nube o de un proveedor suele venir vac\xEDo aunque los anuncios funcionen, as\xED que se
               confirma con los conjuntos y anuncios que ya env\xEDan a WhatsApp con esta p\xE1gina. */
            detail: p.whatsappNumber ? `N\xFAmero vinculado: ${p.whatsappNumber}.` : inUse ? `Meta no expone el n\xFAmero en la p\xE1gina, pero la cuenta ya anuncia a WhatsApp con ella (${conf.source}${conf.numbers.length ? ": " + conf.numbers.join(", ") : ""}): el v\xEDnculo funciona.` : p.whatsappNumber === "" ? "Meta no muestra un n\xFAmero de WhatsApp vinculado y la cuenta no tiene anuncios a WhatsApp con esta p\xE1gina. Si la p\xE1gina no tiene WhatsApp, los anuncios a WhatsApp fallar\xE1n (2446886)." : "No se pudo leer el n\xFAmero vinculado (Meta no siempre lo expone).",
            fix: p.whatsappNumber || inUse ? void 0 : 'Confirma con "Verificar con Meta" en Nueva campa\xF1a. Si falla con 2446886: P\xE1gina \u2192 Configuraci\xF3n \u2192 Cuentas vinculadas \u2192 WhatsApp.'
          });
          checks.push({ group: "Instagram", item: `Instagram de "${p.name}"`, status: p.instagram ? "ok" : "warning", detail: p.instagram ? "@" + (p.instagram.username || p.instagram.id) : "Sin cuenta profesional de Instagram conectada: en Instagram el anuncio sale con el perfil de la p\xE1gina." });
          try {
            const tk = await pageToken(g, p.id);
            const pr = await new Graph(tk).get(p.id, { fields: "leadgen_tos_accepted" }).catch(() => ({}));
            checks.push({
              group: "Formularios",
              item: `Lead Ads de "${p.name}"`,
              status: pr.leadgen_tos_accepted === true ? "ok" : pr.leadgen_tos_accepted === false ? "warning" : "info",
              detail: pr.leadgen_tos_accepted === true ? "Condiciones de Lead Ads aceptadas." : pr.leadgen_tos_accepted === false ? "La p\xE1gina no acept\xF3 las condiciones de Lead Ads." : "No se pudo confirmar las condiciones de Lead Ads.",
              fix: pr.leadgen_tos_accepted === false ? "Un administrador de la p\xE1gina debe aceptarlas en https://www.facebook.com/ads/leadgen/tos" : void 0
            });
          } catch (e) {
            checks.push({ group: "Formularios", item: `Token de "${p.name}"`, status: "warning", detail: e.message });
          }
        }
        const disc = assets.wabaDiscovery || { businesses: [], errors: [] };
        const usedWaDs = [...waUsed.values()].map((d) => assets.pixels.find((px) => px.id === d.id)?.name || d.name || d.id);
        const who = health.user?.name ? `al usuario del sistema "${health.user.name}"` : "al usuario del sistema del token";
        checks.push({
          group: "WhatsApp",
          item: "Cuentas de WhatsApp Business",
          status: assets.wabas.length ? "ok" : usedWaDs.length || (waInfo?.configs || []).length ? "warning" : "info",
          detail: assets.wabas.length ? assets.wabas.map((w) => `${w.name} (${w.numbers.length} n\xFAmeros${w.datasets.length ? ", dataset " + w.datasets[0].id : ", sin dataset"})`).join(" \xB7 ") : "El token no ve ninguna cuenta de WhatsApp Business (WABA)." + (usedWaDs.length ? ` La cuenta s\xED anuncia en WhatsApp midiendo con ${usedWaDs.map((n2) => `"${n2}"`).join(", ")}: la WABA existe, pero no est\xE1 compartida con este token.` : "") + (disc.businesses.length ? ` Portafolios revisados: ${disc.businesses.slice(0, 6).join(", ")}.` : "") + (disc.errors.length ? " Respuesta de Meta: " + disc.errors.slice(0, 2).join(" \xB7 ") : ""),
          fix: assets.wabas.length ? void 0 : `En el Business Manager due\xF1o de la WABA: Configuraci\xF3n del negocio \u2192 Cuentas \u2192 Cuentas de WhatsApp \u2192 la WABA \u2192 Asignar personas \u2192 ${who} con control total. Si la WABA es del cliente, el cliente debe compartirla con tu portafolio como socio. Tambi\xE9n puedes poner su ID en la variable META_WABA_IDS de Netlify para revisarla directamente. Sin la WABA la plataforma no lista n\xFAmeros ni su calidad, pero los anuncios a WhatsApp siguen funcionando.`
        });
        for (const w of assets.wabas) for (const n2 of w.numbers)
          if (n2.qualityRating === "RED" || n2.status !== "CONNECTED") checks.push({ group: "WhatsApp", item: `N\xFAmero ${n2.display}`, status: "warning", detail: `Estado ${n2.status || "\u2014"} \xB7 calidad ${n2.qualityRating || "\u2014"}.` });
        const waNoDs = assets.wabas.filter((w) => !w.datasets.length);
        if (waNoDs.length) checks.push({ group: "Medici\xF3n", item: "Dataset de WhatsApp (CAPI mensajer\xEDa)", status: "warning", detail: "Sin dataset: " + waNoDs.map((w) => w.name).join(", ") + ". Sin \xE9l no se puede optimizar ni medir compras en WhatsApp.", fix: "Events Manager \u2192 Conectar or\xEDgenes de datos \u2192 WhatsApp; luego env\xEDa eventos Purchase con action_source=business_messaging." });
        if (!assets.pixels.length) checks.push({ group: "Medici\xF3n", item: "P\xEDxel / dataset", status: "warning", detail: "La cuenta no tiene p\xEDxeles compartidos." });
        assets.pixels.forEach((px) => {
          const days = px.lastFiredTime ? (Date.now() - Date.parse(px.lastFiredTime)) / 864e5 : null;
          const wa = waUsed.get(px.id);
          const isWa = !!wa || wabaDs.has(px.id);
          const ago = days === null ? "" : days < 1 / 24 ? "hace menos de una hora" : days < 1 ? `hace ${Math.max(1, Math.round(days * 24))} h` : `hace ${Math.floor(days)} d\xEDa${Math.floor(days) === 1 ? "" : "s"}`;
          const vol = px.events7d ? ` ${nf(px.events7d)} eventos en 7 d\xEDas` + (px.topEvents?.length ? ` (${px.topEvents.slice(0, 4).map((e) => `${e.name} ${nf(e.count)}`).join(", ")})` : "") + "." : "";
          const serverOnly = days !== null && !px.browserLastFiredTime ? " Recibe eventos solo por servidor (Conversions API), por eso Meta no informa disparos del navegador." : "";
          const use = wa ? ` Lo usan ${wa.uses} conjunto(s) de WhatsApp para optimizar.` : "";
          const stale = days === null || days > 7 || isWa && wa && days > 2;
          checks.push({
            group: "Medici\xF3n",
            item: `${isWa ? "Dataset de WhatsApp" : "P\xEDxel"} "${px.name}"`,
            status: stale ? "warning" : "ok",
            detail: days === null ? px.statsError ? `Meta no informa disparos del navegador y no se pudieron leer sus estad\xEDsticas (${px.statsError}).${use}` : `Sin eventos en los \xFAltimos 7 d\xEDas, ni del navegador ni del servidor.${use}` : `\xDAltimo evento ${ago}.${vol}${serverOnly}${use}`,
            fix: stale ? (wa ? "Los conjuntos que optimizan con este dataset no pueden aprender sin eventos: revisa que tu CRM o proveedor de WhatsApp siga enviando Purchase/LeadSubmitted con este ID de dataset." : "Revisa el dataset en Events Manager \u2192 Resumen. Si env\xEDas eventos por Conversions API, confirma que usen este ID y un token vigente.") : void 0
          });
        });
      } catch (e) {
        checks.push({ group: "Cuenta", item: "Acceso", status: "error", detail: `${e.info?.message || e.message}${e.info?.code ? ` [${e.info.code}${e.info.subcode ? "/" + e.info.subcode : ""}]` : ""}`, fix: e.info?.recommendation, meta: e.info });
      }
    }
    checks.push({ group: "App", item: "Modo de la app", status: "info", detail: "La API no informa si la app est\xE1 en modo Live. Si Meta responde 1885183, la app est\xE1 en desarrollo.", fix: 'developers.facebook.com \u2192 la app en modo Live, Business verificado y "Ads Management Standard Access".' });
    const order = { error: 0, warning: 1, ok: 2, info: 3 };
    return { ...health, checks: checks.sort((a, b) => order[a.status] - order[b.status]), accountStatusLabels: ACCOUNT_STATUS };
  });
}

// shared/metrics.ts
var LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"];
var CONVERSATION_TYPES = ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"];
var PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase", "offline_conversion.purchase"];
function actionValue(actions, types) {
  if (!actions) return 0;
  for (const t of types) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}
var n = (v2) => v2 === void 0 || v2 === null || v2 === "" ? 0 : Number(v2) || 0;
var div = (a, b) => b ? a / b : 0;
function resultTypesFor(goal, objective) {
  switch (String(goal || "").toUpperCase()) {
    case "CONVERSATIONS":
      return CONVERSATION_TYPES;
    case "LEAD_GENERATION":
    case "QUALITY_LEAD":
      return LEAD_TYPES;
    case "OFFSITE_CONVERSIONS":
    case "VALUE":
    case "MESSAGING_PURCHASE_CONVERSION":
      return PURCHASE_TYPES.concat(LEAD_TYPES);
    case "LINK_CLICKS":
      return ["link_click"];
    case "LANDING_PAGE_VIEWS":
      return ["landing_page_view"];
    case "POST_ENGAGEMENT":
      return ["post_engagement"];
    case "PAGE_LIKES":
      return ["like"];
    case "THRUPLAY":
      return ["video_thruplay_watched_actions", "video_view"];
    case "QUALITY_CALL":
      return ["click_to_call_native_call_placed", "click_to_call_call_confirm"];
    case "APP_INSTALLS":
      return ["mobile_app_install", "app_install"];
  }
  switch (String(objective || "").toUpperCase()) {
    case "OUTCOME_LEADS":
      return LEAD_TYPES.concat(CONVERSATION_TYPES);
    case "OUTCOME_SALES":
      return PURCHASE_TYPES;
    case "OUTCOME_ENGAGEMENT":
      return CONVERSATION_TYPES.concat(["post_engagement"]);
    case "OUTCOME_TRAFFIC":
      return ["landing_page_view", "link_click"];
  }
  return [];
}
function parseInsightRow(r, goal, objective) {
  const spend = n(r.spend), impressions = n(r.impressions), reach = n(r.reach), clicks = n(r.clicks);
  const linkClicks = n(r.inline_link_clicks) || actionValue(r.actions, ["link_click"]);
  const leads = actionValue(r.actions, LEAD_TYPES);
  const conversations = actionValue(r.actions, CONVERSATION_TYPES);
  const purchases = actionValue(r.actions, PURCHASE_TYPES);
  const revenue = actionValue(r.action_values, PURCHASE_TYPES);
  const rt = resultTypesFor(goal, objective);
  const results = rt.length ? actionValue(r.actions, rt) : 0;
  return {
    spend,
    impressions,
    reach,
    clicks,
    linkClicks,
    frequency: n(r.frequency) || div(impressions, reach),
    ctr: n(r.ctr) || div(clicks, impressions) * 100,
    cpc: n(r.cpc) || div(spend, clicks),
    cpm: n(r.cpm) || div(spend, impressions) * 1e3,
    leads,
    conversations,
    purchases,
    revenue,
    cpl: div(spend, leads),
    costPerConversation: div(spend, conversations),
    cpa: div(spend, purchases),
    roas: div(revenue, spend),
    results,
    costPerResult: div(spend, results)
  };
}
function emptyMetrics() {
  return parseInsightRow({});
}
function sumMetrics(rows) {
  const t = emptyMetrics();
  rows.forEach((r) => {
    t.spend += r.spend;
    t.impressions += r.impressions;
    t.reach += r.reach;
    t.clicks += r.clicks;
    t.linkClicks += r.linkClicks;
    t.leads += r.leads;
    t.conversations += r.conversations;
    t.purchases += r.purchases;
    t.revenue += r.revenue;
    t.results += r.results;
  });
  return finalize(t);
}
function finalize(t) {
  t.frequency = div(t.impressions, t.reach);
  t.ctr = div(t.clicks, t.impressions) * 100;
  t.cpc = div(t.spend, t.clicks);
  t.cpm = div(t.spend, t.impressions) * 1e3;
  t.cpl = div(t.spend, t.leads);
  t.costPerConversation = div(t.spend, t.conversations);
  t.cpa = div(t.spend, t.purchases);
  t.roas = div(t.revenue, t.spend);
  t.costPerResult = div(t.spend, t.results);
  return t;
}
function pctChange(cur, prev) {
  if (!prev) return cur ? null : 0;
  return (cur - prev) / Math.abs(prev) * 100;
}
var INSIGHT_FIELDS = "spend,impressions,reach,frequency,cpm,clicks,ctr,cpc,inline_link_clicks,actions,action_values";
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, k) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + k);
  return x;
}
function periodRange(key2, today, custom) {
  const t = /* @__PURE__ */ new Date(today + "T00:00:00Z");
  let since, until;
  switch (key2) {
    case "today":
      since = until = t;
      break;
    case "yesterday":
      since = until = addDays(t, -1);
      break;
    case "last_7d":
      since = addDays(t, -7);
      until = addDays(t, -1);
      break;
    case "last_30d":
      since = addDays(t, -30);
      until = addDays(t, -1);
      break;
    case "this_month":
      since = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      until = t;
      break;
    case "last_month":
      since = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
      until = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
      break;
    default:
      since = /* @__PURE__ */ new Date((custom?.since || today) + "T00:00:00Z");
      until = /* @__PURE__ */ new Date((custom?.until || today) + "T00:00:00Z");
  }
  const days = Math.round((until.getTime() - since.getTime()) / 864e5) + 1;
  let pSince, pUntil;
  if (key2 === "this_month") {
    pSince = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
    pUntil = addDays(pSince, days - 1);
  } else if (key2 === "last_month") {
    pSince = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() - 1, 1));
    pUntil = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 0));
  } else {
    pUntil = addDays(since, -1);
    pSince = addDays(pUntil, -(days - 1));
  }
  return { since: ymd(since), until: ymd(until), prevSince: ymd(pSince), prevUntil: ymd(pUntil), days };
}

// server/lib/access.ts
async function ensureAccountAccess(ctx, accountId) {
  const u = await getUser(ctx.user.email);
  const allowed = u?.accountIds || [];
  const id = String(accountId).startsWith("act_") ? accountId : "act_" + accountId;
  if (allowed.length && !allowed.includes(id)) throw new ApiError(403, "No tienes acceso a esta cuenta publicitaria.", "account_forbidden");
  return id;
}
async function ownerAccounts(g, ids) {
  const list2 = [...new Set(ids.map(String).filter((x) => /^\d+$/.test(x)))];
  const out = {};
  if (!list2.length) return out;
  const res = await g.batch(list2.map((id) => ({ method: "GET", relative_url: `${id}?fields=account_id` })));
  res.forEach((r, i) => {
    if (r.ok && r.body?.account_id) out[list2[i]] = "act_" + String(r.body.account_id).replace(/^act_/, "");
  });
  return out;
}
async function allowedAccounts(ctx) {
  const u = await getUser(ctx.user.email);
  return u?.accountIds?.length ? u.accountIds : null;
}
async function ensurePageAccess(ctx, pageId) {
  const allowed = await allowedAccounts(ctx);
  if (!allowed) return;
  const { graph: graph2 } = await Promise.resolve().then(() => (init_token(), token_exports));
  const { accountAssets: accountAssets2 } = await Promise.resolve().then(() => (init_assets(), assets_exports));
  const g = await graph2();
  for (const acc of allowed) {
    const a = await accountAssets2(g, acc).catch(() => null);
    if (a?.value.pages.some((p) => p.id === String(pageId))) return;
  }
  throw new ApiError(403, "No tienes acceso a esta p\xE1gina.", "page_forbidden");
}

// server/routes/data.ts
init_crypto();

// server/lib/dates.ts
function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
  } catch {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
}

// server/routes/data.ts
init_store();
init_client();
init_assets();
init_entities();
init_whatsapp();

// server/meta/insights.ts
init_store();
init_assets();
var BREAKDOWNS = {
  none: { label: "Total" },
  day: { label: "D\xEDa", timeIncrement: 1 },
  age: { label: "Edad", breakdowns: ["age"] },
  gender: { label: "G\xE9nero", breakdowns: ["gender"] },
  age_gender: { label: "Edad y g\xE9nero", breakdowns: ["age", "gender"] },
  country: { label: "Pa\xEDs", breakdowns: ["country"] },
  region: { label: "Regi\xF3n / estado", breakdowns: ["region"] },
  dma: { label: "DMA (solo EE. UU.)", breakdowns: ["dma"], note: "Meta no ofrece desglose por ciudad en Insights; DMA solo aplica a EE. UU." },
  publisher_platform: { label: "Plataforma", breakdowns: ["publisher_platform"] },
  placement: { label: "Ubicaci\xF3n", breakdowns: ["publisher_platform", "platform_position"] },
  device: { label: "Dispositivo", breakdowns: ["impression_device"] },
  device_platform: { label: "M\xF3vil / escritorio", breakdowns: ["device_platform"] },
  day_hour: { label: "D\xEDa y hora", breakdowns: ["hourly_stats_aggregated_by_advertiser_time_zone"], timeIncrement: 1, note: "Por hora Meta no devuelve alcance ni frecuencia." },
  hour: { label: "Hora (zona de la cuenta)", breakdowns: ["hourly_stats_aggregated_by_advertiser_time_zone"], note: "Por hora Meta no devuelve alcance ni frecuencia." }
};
async function insights(g, q) {
  const act = actId(q.accountId);
  const b = BREAKDOWNS[q.breakdown || "none"] || BREAKDOWNS.none;
  const key2 = `ins:${act}:${q.level}:${q.since}:${q.until}:${q.breakdown || "none"}:${(q.ids || []).join(",")}`;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const ttl = q.until >= today ? 300 : 3600 * 6;
  return cached(key2, ttl, async () => {
    let fields = INSIGHT_FIELDS;
    if (q.breakdown === "hour" || q.breakdown === "day_hour") fields = fields.replace("reach,frequency,", "");
    const idField = q.level === "account" ? "" : `,${q.level === "campaign" ? "campaign_id,campaign_name" : q.level === "adset" ? "campaign_id,adset_id,adset_name" : "campaign_id,adset_id,ad_id,ad_name"}`;
    const params = {
      level: q.level,
      fields: fields + idField,
      time_range: { since: q.since, until: q.until },
      limit: 500,
      /* Atribución de cada conjunto, igual que Ads Manager. */
      use_unified_attribution_setting: true
    };
    if (b.breakdowns) params.breakdowns = b.breakdowns;
    if (b.timeIncrement) params.time_increment = b.timeIncrement;
    if (q.ids?.length) params.filtering = [{ field: (q.filterLevel || q.level) + ".id", operator: "IN", value: q.ids }];
    const rows = await g.all(act + "/insights", params, 30);
    return rows.map((r) => ({
      id: r.ad_id || r.adset_id || r.campaign_id || act,
      name: r.ad_name || r.adset_name || r.campaign_name || "",
      campaignId: r.campaign_id,
      adsetId: r.adset_id,
      date: r.date_start && b.timeIncrement ? r.date_start : void 0,
      dims: Object.fromEntries((b.breakdowns || []).map((k) => [k, r[k]])),
      m: parseInsightRow(r),
      raw: { actions: r.actions, action_values: r.action_values }
    }));
  }, { force: q.force });
}

// server/routes/data.ts
init_token();

// shared/recommendations.ts
var money = (v2, c) => {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(v2);
  } catch {
    return "$" + v2.toFixed(0);
  }
};
var pct = (v2) => v2 === null ? "s/d" : (v2 >= 0 ? "+" : "") + v2.toFixed(1) + " %";
function mainCost(s, m) {
  if (m.purchases) return { label: "CPA", value: m.cpa, results: m.purchases };
  if (m.leads) return { label: "CPL", value: m.cpl, results: m.leads };
  if (m.conversations) return { label: "costo por conversaci\xF3n", value: m.costPerConversation, results: m.conversations };
  return { label: "costo por resultado", value: m.costPerResult, results: m.results };
}
function analyze(subjects, opts = {}) {
  const out = [];
  const minSpend = opts.minSpend ?? 200;
  const add3 = (s, r) => out.push({ id: s.id + ":" + r.category, subjectId: s.id, subjectName: s.name, level: s.level, accountId: s.accountId, accountName: s.accountName, ...r });
  const groups = /* @__PURE__ */ new Map();
  subjects.forEach((s) => {
    const k = s.accountId + "|" + s.level;
    groups.set(k, [...groups.get(k) || [], s]);
  });
  for (const s of subjects) {
    const c = s.current, p = s.previous, cur = s.currency;
    const active = s.status === "ACTIVE";
    if (s.reviewRejected || s.effectiveStatus === "DISAPPROVED")
      add3(s, {
        severity: "critical",
        category: "rejected",
        problem: "Anuncio rechazado por Meta.",
        evidence: ["Estado efectivo: " + s.effectiveStatus].concat(s.issues || []),
        action: "Revisa el motivo del rechazo, corrige el texto o la imagen y vuelve a enviarlo a revisi\xF3n (o duplica con los cambios).",
        impact: "Recuperar entrega del anuncio."
      });
    if (active && ["ACTIVE"].includes(s.effectiveStatus) && c.impressions === 0 && s.daily.length >= 2 && s.daily.slice(-2).every((d) => d.impressions === 0))
      add3(s, {
        severity: "high",
        category: "delivery",
        problem: "Activo pero sin entrega en los \xFAltimos 2 d\xEDas.",
        evidence: ["0 impresiones en 7 d\xEDas", "Estado efectivo: " + s.effectiveStatus],
        action: "Revisa presupuesto, puja (topes muy bajos), segmentaci\xF3n demasiado estrecha o fechas programadas.",
        impact: "Reactivar la entrega."
      });
    if (s.issues?.length && s.effectiveStatus === "WITH_ISSUES")
      add3(s, { severity: "high", category: "delivery", problem: "Meta reporta problemas de entrega.", evidence: s.issues, action: "Atiende el problema indicado por Meta.", impact: "Evitar que el objeto deje de entregar." });
    if (s.learningStage === "FAIL")
      add3(s, {
        severity: "medium",
        category: "limited",
        problem: "Aprendizaje limitado: no alcanza ~50 resultados por semana.",
        evidence: [`${c.results} resultados en 7 d\xEDas`],
        action: "Consolida conjuntos similares, ampl\xEDa la audiencia o usa un evento de optimizaci\xF3n m\xE1s frecuente (p. ej. Lead o Conversaciones en lugar de Compra).",
        impact: "Salir de aprendizaje limitado suele reducir el costo por resultado."
      });
    else if (s.learningStage === "LEARNING" && active)
      add3(s, {
        severity: "low",
        category: "learning",
        problem: "En fase de aprendizaje.",
        evidence: [`${c.results} resultados en 7 d\xEDas`],
        action: "Evita cambios significativos (presupuesto > 20 %, segmentaci\xF3n, creativos) hasta que salga del aprendizaje.",
        impact: "Estabilizar el rendimiento."
      });
    if (c.spend < minSpend) continue;
    const mc = mainCost(s, c), mp = mainCost(s, p);
    if (mc.results && mp.results) {
      const ch = pctChange(mc.value, mp.value);
      if (ch !== null && ch > 30)
        add3(s, {
          severity: ch > 60 ? "high" : "medium",
          category: "cost",
          problem: `El ${mc.label} subi\xF3 ${pct(ch)} en la \xFAltima semana.`,
          evidence: [`${mc.label}: ${money(mp.value, cur)} \u2192 ${money(mc.value, cur)}`, `Gasto 7 d: ${money(c.spend, cur)}`, `CTR ${c.ctr.toFixed(2)} % (${pct(pctChange(c.ctr, p.ctr))})`, `CPM ${money(c.cpm, cur)} (${pct(pctChange(c.cpm, p.cpm))})`],
          action: pctChange(c.cpm, p.cpm) > 25 ? "El CPM explica el alza: ampl\xEDa audiencia o ubicaciones (Advantage+), o revisa competencia estacional." : "Revisa creativos (CTR) y la calidad del tr\xE1fico; considera pausar anuncios con peor costo.",
          impact: `Volver al ${mc.label} previo ahorrar\xEDa ~${money(Math.max(0, c.spend - mp.value * mc.results), cur)} por semana al mismo volumen.`
        });
      if (ch !== null && ch < -20 && active && (s.dailyBudget || 0) > 0 && s.learningStage !== "LEARNING")
        add3(s, {
          severity: "low",
          category: "budget",
          problem: `El ${mc.label} mejor\xF3 ${pct(ch)}: hay espacio para escalar.`,
          evidence: [`${mc.label}: ${money(mp.value, cur)} \u2192 ${money(mc.value, cur)}`, `${mc.results} resultados en 7 d\xEDas`],
          action: `Sube el presupuesto diario 20 % (${money(s.dailyBudget, cur)} \u2192 ${money(s.dailyBudget * 1.2, cur)}).`,
          impact: "Incrementos \u2264 20 % no reinician el aprendizaje; se esperan ~15\u201320 % m\xE1s resultados con costo similar.",
          apply: { field: "daily_budget", value: Math.round(s.dailyBudget * 1.2), from: s.dailyBudget }
        });
    } else if (c.spend > minSpend * 3 && !mc.results && ["OUTCOME_LEADS", "OUTCOME_SALES"].includes(String(s.objective)))
      add3(s, {
        severity: "high",
        category: "cost",
        problem: "Gasto sin resultados.",
        evidence: [`Gasto 7 d: ${money(c.spend, cur)}`, "0 resultados"],
        action: "Verifica que el evento de optimizaci\xF3n se est\xE9 registrando (Centro de eventos) y que el destino funcione; si no, pausa.",
        impact: `Evitar ~${money(c.spend, cur)} semanales sin retorno.`,
        apply: { field: "status", value: "PAUSED", from: s.status }
      });
    const ctrCh = pctChange(c.ctr, p.ctr);
    if (ctrCh !== null && ctrCh < -30 && c.impressions > 5e3)
      add3(s, {
        severity: "medium",
        category: "ctr",
        problem: `El CTR cay\xF3 ${pct(ctrCh)}.`,
        evidence: [`CTR: ${p.ctr.toFixed(2)} % \u2192 ${c.ctr.toFixed(2)} %`, `Frecuencia ${c.frequency.toFixed(1)}`],
        action: "Renueva creativos o prueba nuevos \xE1ngulos de texto.",
        impact: "Un CTR mayor reduce CPC y costo por resultado."
      });
    if (c.frequency > 4)
      add3(s, {
        severity: c.frequency > 6 ? "high" : "medium",
        category: "frequency",
        problem: `Saturaci\xF3n: frecuencia ${c.frequency.toFixed(1)} en 7 d\xEDas.`,
        evidence: [`Alcance ${c.reach.toLocaleString("es-MX")} \xB7 impresiones ${c.impressions.toLocaleString("es-MX")}`, `CTR ${pct(ctrCh)} vs semana previa`],
        action: "Ampl\xEDa la audiencia, excluye convertidos o rota creativos.",
        impact: "Reducir la frecuencia suele recuperar CTR y bajar el CPM efectivo."
      });
    if (s.level === "ad" && s.daily.length >= 10) {
      const first = s.daily.slice(0, 5), last = s.daily.slice(-5);
      const ctrA = avg(first.map((d) => d.ctr)), ctrB = avg(last.map((d) => d.ctr));
      const fB = avg(last.map((d) => d.frequency));
      if (ctrA > 0 && (ctrB - ctrA) / ctrA < -0.25 && fB > 2.5)
        add3(s, {
          severity: "medium",
          category: "fatigue",
          problem: "Fatiga creativa: el CTR baja de forma sostenida mientras sube la frecuencia.",
          evidence: [`CTR promedio: ${ctrA.toFixed(2)} % \u2192 ${ctrB.toFixed(2)} %`, `Frecuencia diaria reciente ${fB.toFixed(1)}`],
          action: "Crea variantes del anuncio (nuevo visual o gancho) y pausa este cuando las nuevas tengan entrega.",
          impact: "Recuperar el CTR inicial."
        });
    }
    const cpmCh = pctChange(c.cpm, p.cpm);
    if (cpmCh !== null && cpmCh > 40 && c.impressions > 1e4)
      add3(s, {
        severity: "low",
        category: "cpm",
        problem: `CPM ${pct(cpmCh)} vs semana previa.`,
        evidence: [`CPM: ${money(p.cpm, cur)} \u2192 ${money(c.cpm, cur)}`],
        action: "Revisa si la audiencia es muy estrecha o si hay ubicaciones manuales costosas; prueba Advantage+ placements.",
        impact: "M\xE1s alcance con el mismo presupuesto."
      });
    if (c.revenue && p.revenue) {
      const rCh = pctChange(c.roas, p.roas);
      if (rCh !== null && rCh < -25)
        add3(s, {
          severity: "medium",
          category: "roas",
          problem: `ROAS ${pct(rCh)}.`,
          evidence: [`ROAS: ${p.roas.toFixed(2)} \u2192 ${c.roas.toFixed(2)}`, `Ingresos 7 d: ${money(c.revenue, cur)}`],
          action: "Revisa el valor por compra y el mix de productos; considera puja por ROAS m\xEDnimo.",
          impact: "Proteger la rentabilidad."
        });
    }
    if (s.lifetimeBudget && s.endTime) {
      const daysLeft = (Date.parse(s.endTime) - Date.now()) / 864e5;
      const avgDaily = avg(s.daily.slice(-3).map((d) => d.spend));
      const spentPct = s.daily.reduce((a, d) => a + d.spend, 0) / s.lifetimeBudget * 100;
      if (daysLeft > 5 && spentPct > 90)
        add3(s, {
          severity: "high",
          category: "budget",
          problem: `Presupuesto total consumido al ${spentPct.toFixed(0)} % y quedan ${daysLeft.toFixed(0)} d\xEDas.`,
          evidence: [`Gasto diario reciente ${money(avgDaily, cur)}`],
          action: "Aumenta el presupuesto total o ajusta la fecha de fin.",
          impact: "Evitar que la campa\xF1a se detenga antes de tiempo."
        });
    }
  }
  for (const [, list2] of groups) {
    const withRes = list2.filter((s) => s.current.spend >= minSpend && mainCost(s, s.current).results > 0);
    if (withRes.length < 3) continue;
    const total = withRes.reduce((a, s) => a + s.current.spend, 0);
    const costs = withRes.map((s) => mainCost(s, s.current).value).sort((a, b) => a - b);
    const med = costs[Math.floor(costs.length / 2)];
    withRes.forEach((s) => {
      const share = s.current.spend / total, mc = mainCost(s, s.current);
      if (share > 0.5 && mc.value > med * 1.5)
        add3(s, {
          severity: "medium",
          category: "distribution",
          problem: `Concentra ${(share * 100).toFixed(0)} % del gasto con un ${mc.label} ${(mc.value / med).toFixed(1)}\xD7 la mediana.`,
          evidence: [`${mc.label}: ${money(mc.value, s.currency)} vs mediana ${money(med, s.currency)}`],
          action: "Redistribuye presupuesto hacia los objetos con mejor costo o limita el gasto de este.",
          impact: "M\xE1s resultados con el mismo presupuesto total."
        });
    });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
function avg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

// shared/reports.ts
var KPI_LABEL = {
  purchases: { one: "compra", many: "Compras", cost: "Costo por compra" },
  conversations: { one: "conversaci\xF3n", many: "Conversaciones", cost: "Costo por conversaci\xF3n" },
  leads: { one: "lead", many: "Leads", cost: "Costo por lead" },
  linkClicks: { one: "clic", many: "Clics en el enlace", cost: "CPC (enlace)" }
};
function pickKpi(t) {
  if (t.purchases >= 3) return "purchases";
  if (t.conversations >= 3) return "conversations";
  if (t.leads >= 3) return "leads";
  return t.purchases ? "purchases" : t.conversations ? "conversations" : t.leads ? "leads" : "linkClicks";
}
var kpiCost = (m, k) => m[k] ? m.spend / m[k] : 0;
function add(a, b) {
  ["spend", "impressions", "reach", "clicks", "linkClicks", "leads", "conversations", "purchases", "revenue", "results"].forEach((k) => {
    a[k] += b[k] || 0;
  });
}
function hourOf(v2) {
  const h = parseInt(String(v2 || "").slice(0, 2), 10);
  return isFinite(h) ? h : -1;
}
function hourly(rows, kpi) {
  const acc = Array.from({ length: 24 }, () => emptyMetrics());
  rows.forEach((r) => {
    if (r.hour >= 0 && r.hour < 24) add(acc[r.hour], r.m);
  });
  const tot = finalize(acc.reduce((t, m) => {
    add(t, m);
    return t;
  }, emptyMetrics()));
  const avg2 = kpiCost(tot, kpi);
  return acc.map((m, hour) => {
    const f = finalize(m);
    const cost = kpiCost(f, kpi);
    return { hour, m: f, share: tot.spend ? f.spend / tot.spend : 0, kpi: f[kpi], cost, index: cost && avg2 ? Math.round(avg2 / cost * 100) : f.spend ? 0 : 100 };
  });
}
var WEEKDAYS = ["Lun", "Mar", "Mi\xE9", "Jue", "Vie", "S\xE1b", "Dom"];
function heatmap(rows) {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => emptyMetrics()));
  rows.forEach((r) => {
    if (r.hour < 0 || !r.date) return;
    const wd = ((/* @__PURE__ */ new Date(r.date + "T12:00:00Z")).getUTCDay() + 6) % 7;
    add(cells[wd][r.hour], r.m);
  });
  return cells.map((row) => row.map((m) => finalize(m)));
}
var pct2 = (v2) => v2 === null ? "sin datos del periodo anterior" : (v2 > 0 ? "+" : "") + v2.toFixed(0) + " %";
function kpiForObjective(objective, m) {
  switch (objective) {
    case "OUTCOME_SALES":
      return m.purchases || !m.conversations ? "purchases" : "conversations";
    case "OUTCOME_LEADS":
      return m.leads || !m.conversations ? "leads" : "conversations";
    case "OUTCOME_ENGAGEMENT":
      return m.conversations ? "conversations" : null;
    case "OUTCOME_TRAFFIC":
      return "linkClicks";
    case "OUTCOME_AWARENESS":
    case "OUTCOME_APP_PROMOTION":
      return null;
  }
  return pickKpi(m);
}
var hh = (h) => String(h).padStart(2, "0") + ":00";
function narrate(input) {
  const { totals: t, previous: p, kpi, hours, entities, money: money2 } = input;
  const L = KPI_LABEL[kpi];
  const out = [];
  const ck = kpiCost(t, kpi), cp = kpiCost(p, kpi);
  if (t.spend) {
    const dS = pctChange(t.spend, p.spend), dK = pctChange(t[kpi], p[kpi]), dC = cp && ck ? pctChange(ck, cp) : null;
    const good = dC !== null ? dC < -5 : (dK || 0) > 5;
    out.push({
      tone: dC === null ? "info" : good ? "good" : dC > 10 ? "bad" : "info",
      title: p.spend ? `${L.many}: ${Math.round(t[kpi]).toLocaleString("es-MX")} (${pct2(dK)}) con ${money2(t.spend)} de gasto (${pct2(dS)})` : `${L.many}: ${Math.round(t[kpi]).toLocaleString("es-MX")} con ${money2(t.spend)} de gasto (sin datos del periodo anterior)`,
      detail: ck ? `${L.cost}: ${money2(ck)}${dC !== null ? ` (${pct2(dC)} vs periodo anterior)` : ""}.` + (dS !== null && dK !== null && dS > 10 && dK < dS - 15 ? " El gasto creci\xF3 m\xE1s que los resultados: revisa saturaci\xF3n de audiencia y creativos." : "") : "Sin resultados en el periodo."
    });
  }
  const active = hours.filter((h) => h.m.spend > 0);
  if (active.length >= 6 && t[kpi] >= 5) {
    const best = [...active].filter((h) => h.kpi > 0).sort((a, b) => a.cost - b.cost).slice(0, 3);
    const worst = [...active].filter((h) => h.share >= 0.02 && (h.kpi === 0 || h.index < 70)).sort((a, b) => b.m.spend - a.m.spend).slice(0, 3);
    const peak = [...active].sort((a, b) => b.kpi - a.kpi).slice(0, 3).sort((a, b) => a.hour - b.hour);
    if (best.length) out.push({ tone: "good", title: `Mejores horas: ${best.map((h) => hh(h.hour)).join(", ")}`, detail: `${L.cost} de ${best.map((h) => money2(h.cost)).join(" / ")} frente a ${money2(ck)} de promedio. Mayor volumen de ${L.many.toLowerCase()}: ${peak.map((h) => hh(h.hour)).join(", ")}.` });
    if (worst.length) {
      const spend = worst.reduce((s, h) => s + h.m.spend, 0);
      out.push({ tone: "bad", title: `Horas caras: ${worst.map((h) => hh(h.hour)).join(", ")}`, detail: `Suman ${money2(spend)} (${Math.round(spend / t.spend * 100)} % del gasto): ${worst.map((h) => `${hh(h.hour)} ${h.kpi ? money2(h.cost) + " por " + L.one : "sin " + L.many.toLowerCase()}`).join(" \xB7 ")}. Meta optimiza la entrega por hora autom\xE1ticamente; en vez de apagar horas, revisa el mensaje y \u2014en WhatsApp\u2014 la atenci\xF3n en esas horas.` });
    }
    const night = active.filter((h) => h.hour <= 5).reduce((s, h) => s + h.m.spend, 0);
    if (t.spend && night / t.spend > 0.12) out.push({ tone: "info", title: `${Math.round(night / t.spend * 100)} % del gasto ocurre entre 00:00 y 05:59`, detail: "Si en esas horas nadie responde WhatsApp o el call center est\xE1 cerrado, configura respuestas autom\xE1ticas o eval\xFAa programaci\xF3n de anuncios (requiere presupuesto total)." });
  }
  if (input.heat) {
    const days = input.heat.map((row, i) => {
      const m = finalize(row.reduce((a, c) => {
        add(a, c);
        return a;
      }, emptyMetrics()));
      return { i, m, cost: kpiCost(m, kpi) };
    }).filter((d) => d.m.spend > 0 && d.m[kpi] > 0);
    if (days.length >= 5) {
      const b = [...days].sort((a, c) => a.cost - c.cost)[0], w = [...days].sort((a, c) => c.cost - a.cost)[0];
      if (w.cost > b.cost * 1.25) out.push({ tone: "info", title: `Mejor d\xEDa: ${WEEKDAYS[b.i]} \xB7 m\xE1s caro: ${WEEKDAYS[w.i]}`, detail: `${L.cost}: ${money2(b.cost)} el ${WEEKDAYS[b.i].toLowerCase()} vs ${money2(w.cost)} el ${WEEKDAYS[w.i].toLowerCase()}.` });
    }
  }
  const withSpend = entities.filter((e) => e.m.spend > 0);
  const total = withSpend.reduce((s, e) => s + e.m.spend, 0);
  const sameKpi = withSpend.filter((e) => kpiForObjective(e.objective, e.m) === kpi);
  if (withSpend.length >= 3 && total) {
    const top = [...withSpend].sort((a, b) => b.m.spend - a.m.spend)[0];
    if (top.m.spend / total > 0.6) out.push({ tone: "info", title: `\u201C${top.name}\u201D concentra ${Math.round(top.m.spend / total * 100)} % del gasto`, detail: "Una sola pieza sostiene la cuenta: prepara variantes antes de que se fatigue." });
    const eff = sameKpi.filter((e) => e.m[kpi] >= 3).sort((a, b) => kpiCost(a.m, kpi) - kpiCost(b.m, kpi));
    if (eff.length >= 2) {
      const b = eff[0], w = eff[eff.length - 1];
      out.push({ tone: "good", title: `M\xE1s eficiente: \u201C${b.name}\u201D (${money2(kpiCost(b.m, kpi))})`, detail: `Menos eficiente con volumen: \u201C${w.name}\u201D (${money2(kpiCost(w.m, kpi))}). Mover presupuesto gradualmente (\u2264 20 % cada 2\u20133 d\xEDas) evita reiniciar el aprendizaje.` });
    }
    const zero = sameKpi.filter((e) => e.m[kpi] === 0 && ck && e.m.spend > ck * 2);
    if (zero.length) out.push({ tone: "bad", title: `${zero.length} elemento(s) gastaron m\xE1s de 2\xD7 el ${L.cost.toLowerCase()} sin ${L.many.toLowerCase()}`, detail: zero.slice(0, 4).map((e) => `\u201C${e.name}\u201D ${money2(e.m.spend)}`).join(" \xB7 ") });
  }
  if (t.frequency > 3.5) out.push({ tone: "bad", title: `Frecuencia alta: ${t.frequency.toFixed(1)}`, detail: "La misma gente ve los anuncios muchas veces: ampl\xEDa la audiencia (Advantage+ audience) o renueva creativos." });
  if (t.impressions > 5e3 && t.ctr < 0.7) out.push({ tone: "bad", title: `CTR bajo: ${t.ctr.toFixed(2)} %`, detail: "Prueba ganchos en los primeros 3 segundos, formatos 9:16 para Reels/Stories y una oferta m\xE1s clara." });
  if (p.cpm && t.cpm > p.cpm * 1.25) out.push({ tone: "info", title: `El CPM subi\xF3 ${pct2(pctChange(t.cpm, p.cpm))}`, detail: "Puede ser competencia estacional o una audiencia m\xE1s estrecha." });
  return out;
}
var isOn = (s) => s === "ACTIVE";
function bestPractices(s, money2) {
  const out = [];
  const liveCamp = new Set(s.campaigns.filter((c) => isOn(c.effectiveStatus)).map((c) => c.id));
  const adsets = s.adsets.filter((a) => isOn(a.effectiveStatus) && liveCamp.has(a.campaignId));
  const campOf = new Map(s.campaigns.map((c) => [c.id, c]));
  const adsOf = (id) => s.ads.filter((a) => a.adsetId === id && isOn(a.effectiveStatus));
  const ent = (a) => ({ id: a.id, name: a.name, level: "adset" });
  const base = { accountName: s.accountName };
  const limited = adsets.filter((a) => a.learningStage === "FAIL");
  const lowEvents = adsets.filter((a) => {
    const m = s.adsetMetrics[a.id];
    return m && m.spend > 0 && m.results < 50 && a.learningStage !== "SUCCESS";
  });
  if (limited.length) out.push({
    ...base,
    id: "learning-limited",
    severity: "alta",
    category: "Aprendizaje",
    title: `${limited.length} conjunto(s) con aprendizaje limitado`,
    detail: "Meta necesita ~50 eventos de optimizaci\xF3n por semana en cada conjunto para salir de la fase de aprendizaje. Con menos, la entrega es inestable y m\xE1s cara.",
    action: "Consolida conjuntos con audiencias parecidas, sube el presupuesto o elige un evento m\xE1s frecuente (p. ej. conversaciones en lugar de compras mientras juntas volumen).",
    source: "Meta \xB7 Fase de aprendizaje / Aprendizaje limitado",
    entities: limited.map(ent)
  });
  else if (lowEvents.length >= 3) out.push({
    ...base,
    id: "learning-low",
    severity: "media",
    category: "Aprendizaje",
    title: `${lowEvents.length} conjuntos con menos de 50 resultados en 7 d\xEDas`,
    detail: "Est\xE1n por debajo del umbral que Meta recomienda para estabilizar la entrega.",
    action: "Agrupa conjuntos o usa presupuesto de campa\xF1a (Advantage campaign budget).",
    source: "Meta \xB7 Fase de aprendizaje",
    entities: lowEvents.slice(0, 10).map(ent)
  });
  for (const c of s.campaigns.filter((c2) => liveCamp.has(c2.id))) {
    const as = adsets.filter((a) => a.campaignId === c.id);
    if (as.length >= 6) out.push({
      ...base,
      id: "fragmented-" + c.id,
      severity: "media",
      category: "Estructura",
      title: `\u201C${c.name}\u201D tiene ${as.length} conjuntos activos`,
      detail: "Muchos conjuntos compiten entre s\xED por la misma gente y dividen el aprendizaje.",
      action: "Consolida en 2\u20134 conjuntos con audiencias amplias y deja que Meta distribuya (Advantage campaign budget).",
      source: "Meta \xB7 Simplificaci\xF3n de estructura de la cuenta",
      entities: [{ id: c.id, name: c.name, level: "campaign" }]
    });
  }
  const manual = adsets.filter((a) => Array.isArray(a.targeting?.publisher_platforms) && a.targeting.publisher_platforms.length > 0);
  if (manual.length) out.push({
    ...base,
    id: "placements",
    severity: "media",
    category: "Ubicaciones",
    title: `${manual.length} conjunto(s) con ubicaciones manuales`,
    detail: "Meta reporta costos por resultado menores con Advantage+ placements porque puede usar el inventario m\xE1s barato en cada momento.",
    action: "Activa ubicaciones Advantage+ salvo que una ubicaci\xF3n sea imposible para tu creativo.",
    source: "Meta \xB7 Advantage+ placements",
    entities: manual.slice(0, 10).map(ent)
  });
  const narrow = adsets.filter((a) => a.targeting && !a.targeting?.targeting_automation?.advantage_audience && ((a.targeting.flexible_spec || []).length || (a.targeting.interests || []).length));
  if (narrow.length) out.push({
    ...base,
    id: "audience",
    severity: "baja",
    category: "Audiencia",
    title: `${narrow.length} conjunto(s) con intereses sin Advantage+ audience`,
    detail: "La segmentaci\xF3n detallada estrecha limita el aprendizaje. Con Advantage+ audience tus intereses pasan a ser sugerencias.",
    action: "Prueba Advantage+ audience en un duplicado (A/B) antes de cambiar el original.",
    source: "Meta \xB7 Advantage+ audience",
    entities: narrow.slice(0, 10).map(ent)
  });
  const fewAds = adsets.filter((a) => adsOf(a.id).length > 0 && adsOf(a.id).length < 3);
  if (fewAds.length) out.push({
    ...base,
    id: "creative-count",
    severity: "media",
    category: "Creativos",
    title: `${fewAds.length} conjunto(s) con menos de 3 anuncios activos`,
    detail: "Meta recomienda varios creativos distintos por conjunto (formatos y mensajes diferentes) para encontrar ganadores y evitar fatiga.",
    action: "Agrega 3\u20136 anuncios con conceptos distintos: video 9:16 para Reels/Stories, imagen 1:1/4:5 y carrusel.",
    source: "Meta \xB7 Diversificaci\xF3n creativa",
    entities: fewAds.slice(0, 10).map(ent)
  });
  const noVideo = adsets.filter((a) => {
    const ads = adsOf(a.id);
    return ads.length >= 2 && ads.every((x) => !x.creative?.videoId);
  });
  if (noVideo.length >= 2) out.push({
    ...base,
    id: "creative-video",
    severity: "baja",
    category: "Creativos",
    title: `${noVideo.length} conjunto(s) sin ning\xFAn video`,
    detail: "Reels y Stories priorizan video vertical; sin video pierdes inventario de bajo costo.",
    action: "Sube al menos un video 9:16 de 6\u201315 s con el mensaje en los primeros 3 segundos.",
    source: "Meta \xB7 Buenas pr\xE1cticas para Reels",
    entities: noVideo.slice(0, 10).map(ent)
  });
  const under = adsets.filter((a) => {
    const m = s.adsetMetrics[a.id];
    const c = campOf.get(a.campaignId);
    const daily = a.dailyBudget || c?.dailyBudget || 0;
    if (!m || !m.results || !daily) return false;
    const cpr = m.spend / m.results;
    const nAdsets = c?.dailyBudget ? adsets.filter((x) => x.campaignId === c.id).length : 1;
    return daily / nAdsets * 7 < cpr * 50 * 0.5;
  });
  if (under.length) out.push({
    ...base,
    id: "budget",
    severity: "media",
    category: "Presupuesto",
    title: `${under.length} conjunto(s) con presupuesto insuficiente para aprender`,
    detail: "Con su costo por resultado actual, el presupuesto semanal no alcanza ni la mitad de los ~50 resultados que Meta necesita.",
    action: "Sube el presupuesto o consolida: presupuesto semanal \u2248 50 \xD7 costo por resultado.",
    source: "Meta \xB7 Fase de aprendizaje",
    entities: under.slice(0, 10).map(ent)
  });
  const stale = (s.pixels || []).filter((p) => !p.lastFiredTime || Date.now() - Date.parse(p.lastFiredTime) > 3 * 864e5);
  const usedPixels = new Set(adsets.map((a) => String(a.promotedObject?.pixel_id || "")).filter(Boolean));
  const staleUsed = stale.filter((p) => usedPixels.has(p.id));
  if (staleUsed.length) out.push({
    ...base,
    id: "pixel-stale",
    severity: "alta",
    category: "Eventos",
    title: `Conjuntos optimizando con un p\xEDxel sin eventos recientes: ${staleUsed.map((p) => p.name).join(", ")}`,
    detail: "Si el p\xEDxel/dataset no recibe el evento, Meta no puede optimizar y la entrega cae.",
    action: "Revisa la instalaci\xF3n en Events Manager y agrega Conversions API (servidor) para no depender del navegador.",
    source: "Meta \xB7 Conversions API"
  });
  const waConv = adsets.filter((a) => a.destinationType === "WHATSAPP" && a.optimizationGoal === "CONVERSATIONS");
  const waBuy = adsets.filter((a) => a.destinationType === "WHATSAPP" && ["OFFSITE_CONVERSIONS", "MESSAGING_PURCHASE_CONVERSION", "VALUE"].includes(String(a.optimizationGoal)));
  if (waConv.length && s.whatsappPurchaseDataset) out.push({
    ...base,
    id: "wa-purchase",
    severity: "media",
    category: "WhatsApp",
    title: `${waConv.length} conjunto(s) de WhatsApp optimizan por conversaciones y la cuenta ya mide compras por mensajes`,
    detail: waBuy.length ? `La cuenta ya tiene ${waBuy.length} conjunto(s) optimizando a compras en WhatsApp: esa configuraci\xF3n se puede replicar.` : "Con el dataset de la WABA recibiendo Purchase (business_messaging), Meta puede buscar a quienes compran, no solo a quienes escriben.",
    action: "Crea una prueba A/B con Ventas \u2192 WhatsApp \u2192 conversiones (Purchase) usando \u201CUsar esta configuraci\xF3n\u201D en Nueva campa\xF1a.",
    source: "Meta \xB7 Conversions API para mensajer\xEDa",
    entities: waConv.slice(0, 10).map(ent)
  });
  const tired = adsets.filter((a) => (s.adsetMetrics[a.id]?.frequency || 0) > 4);
  if (tired.length) out.push({
    ...base,
    id: "frequency",
    severity: "media",
    category: "Fatiga",
    title: `${tired.length} conjunto(s) con frecuencia > 4 en 7 d\xEDas`,
    detail: "La audiencia ya vio los anuncios muchas veces; el CTR suele caer y el costo subir.",
    action: "Ampl\xEDa la audiencia o rota creativos nuevos.",
    source: "Meta \xB7 Fatiga creativa",
    entities: tired.slice(0, 10).map(ent)
  });
  void money2;
  const rank = { alta: 0, media: 1, baja: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// server/reports.ts
init_currency();

// server/analytics.ts
init_entities();
function add2(a, b) {
  ["spend", "impressions", "reach", "clicks", "linkClicks", "leads", "conversations", "purchases", "revenue", "results"].forEach((k) => {
    a[k] += b[k];
  });
}
async function buildSubjects(g, acc) {
  const today = todayIn(acc.timezone);
  const p7 = periodRange("last_7d", today);
  const p30 = periodRange("last_30d", today);
  const st = (await structure(g, acc.id, acc.currency, {})).value;
  const goalOf = new Map(st.adsets.map((x) => [x.id, x.optimizationGoal]));
  const objOf = new Map(st.campaigns.map((x) => [x.id, x.objective]));
  const levels = ["campaign", "adset", "ad"];
  const series = await Promise.all(levels.map((level) => insights(g, { accountId: acc.id, level, since: p30.prevSince < p7.prevSince ? p30.since : p7.prevSince, until: p7.until, breakdown: "day" })));
  const byId = /* @__PURE__ */ new Map();
  series.forEach((s) => s.value.forEach((r) => {
    const m = parseInsightRow(
      { ...r.raw, spend: r.m.spend, impressions: r.m.impressions, reach: r.m.reach, clicks: r.m.clicks, inline_link_clicks: r.m.linkClicks },
      r.adsetId ? goalOf.get(r.adsetId) : void 0,
      objOf.get(r.campaignId || r.id)
    );
    byId.set(r.id, [...byId.get(r.id) || [], { date: r.date, m }]);
  }));
  const windowSum = (id, since, until) => {
    const t = emptyMetrics();
    (byId.get(id) || []).filter((d) => d.date >= since && d.date <= until).forEach((d) => add2(t, d.m));
    return finalize(t);
  };
  const dailySeries = (id, days) => {
    const out = [];
    for (let i = days; i >= 1; i--) {
      const d = /* @__PURE__ */ new Date(today + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      const k = d.toISOString().slice(0, 10);
      const row = (byId.get(id) || []).find((x) => x.date === k);
      out.push(row ? row.m : emptyMetrics());
    }
    return out;
  };
  const windows = (id) => {
    const w = {}, pv = {};
    for (const n2 of [1, 3, 7, 14, 30]) {
      const r = periodRange("custom", today, { since: shift(today, -n2), until: shift(today, -1) });
      w[n2] = windowSum(id, r.since, r.until);
      pv[n2] = windowSum(id, r.prevSince, r.prevUntil);
    }
    return { w, pv };
  };
  const ents = [
    ...st.campaigns.map((c) => ({ level: "campaign", id: c.id, name: c.name, status: c.status, eff: c.effectiveStatus, objective: c.objective, daily: c.dailyBudget, life: c.lifetimeBudget, end: c.stopTime, issues: c.issues, created: c.createdTime })),
    ...st.adsets.map((a) => ({ level: "adset", id: a.id, name: a.name, status: a.status, eff: a.effectiveStatus, objective: objOf.get(a.campaignId), goal: a.optimizationGoal, daily: a.dailyBudget, life: a.lifetimeBudget, end: a.endTime, learning: a.learningStage, issues: a.issues, created: a.createdTime })),
    ...st.ads.map((a) => ({ level: "ad", id: a.id, name: a.name, status: a.status, eff: a.effectiveStatus, objective: objOf.get(a.campaignId), goal: goalOf.get(a.adsetId), issues: a.issues, rejected: a.effectiveStatus === "DISAPPROVED", created: a.createdTime }))
  ];
  const analysis = [];
  const rules = [];
  for (const e of ents) {
    const { w, pv } = windows(e.id);
    const lifetimeSpent = e.life ? (byId.get(e.id) || []).reduce((s, d) => s + d.m.spend, 0) : void 0;
    analysis.push({
      id: e.id,
      name: e.name,
      level: e.level,
      accountId: acc.id,
      accountName: acc.name,
      currency: acc.currency,
      status: e.status,
      effectiveStatus: e.eff,
      objective: e.objective,
      optimizationGoal: e.goal,
      current: w[7],
      previous: pv[7],
      daily: dailySeries(e.id, 14),
      dailyBudget: e.daily,
      lifetimeBudget: e.life,
      learningStage: e.learning,
      issues: e.issues,
      reviewRejected: e.rejected,
      createdTime: e.created,
      endTime: e.end
    });
    rules.push({
      id: e.id,
      name: e.name,
      level: e.level,
      accountId: acc.id,
      status: e.status,
      currency: acc.currency,
      windows: w,
      previous: pv,
      daily: dailySeries(e.id, 30),
      dailyBudget: e.daily,
      lifetimeBudget: e.life,
      lifetimeSpent,
      endTime: e.end
    });
  }
  return { analysis, rules, structure: st };
}
function shift(d, n2) {
  const x = /* @__PURE__ */ new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n2);
  return x.toISOString().slice(0, 10);
}

// server/reports.ts
init_assets();
init_entities();
async function accountReport(g, acc, o) {
  const pr = periodRange(o.period, todayIn(acc.timezone), o.since && o.until ? { since: o.since, until: o.until } : void 0);
  const base = { accountId: acc.id, force: o.force };
  const warnings = [];
  const soft = async (label, p, fallback) => {
    try {
      return await p;
    } catch (e) {
      warnings.push(`${label}: ${e?.info?.message || e?.message || e}`);
      return fallback;
    }
  };
  const [cur, prev, dh, ents, entsPrev, st] = await Promise.all([
    insights(g, { ...base, level: "account", since: pr.since, until: pr.until }),
    insights(g, { ...base, level: "account", since: pr.prevSince, until: pr.prevUntil }),
    soft("Horas", insights(g, { ...base, level: "account", since: pr.since, until: pr.until, breakdown: "day_hour" }), { value: [], cachedAt: "", fromCache: false }),
    insights(g, { ...base, level: o.level, since: pr.since, until: pr.until }),
    soft("Periodo anterior por nivel", insights(g, { ...base, level: o.level, since: pr.prevSince, until: pr.prevUntil }), { value: [], cachedAt: "", fromCache: false }),
    soft("Estructura", structure(g, acc.id, acc.currency, {}), null)
  ]);
  const totals = sumMetrics(cur.value.map((r) => r.m));
  const previous = sumMetrics(prev.value.map((r) => r.m));
  const kpi = o.kpi && o.kpi !== "auto" ? o.kpi : pickKpi(totals);
  const money2 = (v2) => formatMoney(v2, acc.currency);
  const hrRows = dh.value.map((r) => ({ date: r.date || "", hour: hourOf(r.dims.hourly_stats_aggregated_by_advertiser_time_zone), m: r.m }));
  const hours = hourly(hrRows, kpi);
  const heat = heatmap(hrRows);
  const byDate = /* @__PURE__ */ new Map();
  hrRows.forEach((r) => {
    const t = byDate.get(r.date) || emptyMetrics();
    ["spend", "impressions", "clicks", "linkClicks", "leads", "conversations", "purchases", "revenue"].forEach((k) => {
      t[k] += r.m[k];
    });
    byDate.set(r.date, t);
  });
  const daily = [...byDate.entries()].filter(([d]) => d).sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({ date, m: finalize(m) }));
  const prevById = new Map(entsPrev.value.map((r) => [r.id, r.m]));
  const S2 = st?.value;
  const campObj = new Map((S2?.campaigns || []).map((c) => [c.id, c.objective]));
  const entities = ents.value.map((r) => ({ id: r.id, name: r.name, level: o.level, accountName: acc.name, objective: campObj.get(r.campaignId || r.id), m: r.m, prev: prevById.get(r.id) })).sort((a, b) => b.m.spend - a.m.spend);
  const insightsText = narrate({ totals, previous, kpi, hours, heat, entities, money: money2 });
  let practices = [];
  if (S2) {
    const p7 = periodRange("last_7d", todayIn(acc.timezone));
    const [as7, assets] = await Promise.all([
      soft("Conjuntos (7 d\xEDas)", insights(g, { ...base, level: "adset", since: p7.since, until: p7.until }), { value: [], cachedAt: "", fromCache: false }),
      soft("Activos", accountAssets(g, acc.id), null)
    ]);
    const goalOf = new Map(S2.adsets.map((a) => [a.id, a.optimizationGoal]));
    const adsetMetrics = {};
    as7.value.forEach((r) => {
      const m = { ...r.m };
      const goal = String(goalOf.get(r.id) || "");
      m.results = goal === "CONVERSATIONS" ? m.conversations : goal === "LEAD_GENERATION" ? m.leads : ["OFFSITE_CONVERSIONS", "VALUE", "MESSAGING_PURCHASE_CONVERSION"].includes(goal) ? m.purchases || m.leads : goal === "LINK_CLICKS" || goal === "LANDING_PAGE_VIEWS" ? m.linkClicks : m.results;
      adsetMetrics[r.id] = m;
    });
    const A = assets?.value;
    const waDs = new Set((A?.wabas || []).flatMap((w) => w.datasets.map((d) => d.id)));
    const waPurchase = S2.adsets.some((a) => a.destinationType === "WHATSAPP" && a.promotedObject?.custom_event_type === "PURCHASE") || waDs.size > 0;
    practices = bestPractices({ accountName: acc.name, currency: acc.currency, campaigns: S2.campaigns, adsets: S2.adsets, ads: S2.ads, adsetMetrics, pixels: A?.pixels, whatsappPurchaseDataset: waPurchase }, money2);
  }
  const recs = await soft("Recomendaciones", buildSubjects(g, acc).then((x) => analyze(x.analysis)), []);
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const topRecs = recs.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)).slice(0, 8);
  return {
    account: { id: acc.id, name: acc.name, currency: acc.currency, timezone: acc.timezone },
    period: pr,
    kpi,
    totals,
    previous,
    costPerKpi: kpiCost(totals, kpi),
    prevCostPerKpi: kpiCost(previous, kpi),
    daily,
    hours,
    heat,
    entities: entities.slice(0, 200),
    insights: insightsText,
    practices,
    recommendations: topRecs,
    warnings,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// server/routes/data.ts
var force = (ctx) => ctx.url.searchParams.get("force") === "1";
async function accountCtx(ctx) {
  const id = await ensureAccountAccess(ctx, ctx.params.id);
  const g = await graph();
  const list2 = (await adAccounts(g)).value;
  const acc = list2.find((a) => a.id === id) || await account(g, id);
  return { g, id, acc };
}
function periodFrom(ctx, tz) {
  const p = ctx.url.searchParams.get("period") || "last_7d";
  const since = ctx.url.searchParams.get("since") || void 0, until = ctx.url.searchParams.get("until") || void 0;
  return periodRange(p, todayIn(tz), since && until ? { since, until } : void 0);
}
function registerData(r) {
  r.get("/api/businesses", async (ctx) => {
    const g = await graph();
    return businesses(g, force(ctx));
  });
  r.get("/api/accounts", async (ctx) => {
    const g = await graph();
    const res = await adAccounts(g, force(ctx));
    const allowed = await allowedAccounts(ctx);
    const value = allowed ? res.value.filter((a) => allowed.includes(a.id)) : res.value;
    await kv("core").set("sync/accounts", { at: (/* @__PURE__ */ new Date()).toISOString(), by: ctx.user.email }).catch(() => void 0);
    return { ...res, value };
  });
  r.get("/api/accounts/:id/assets", async (ctx) => {
    const { g, id } = await accountCtx(ctx);
    return accountAssets(g, id, force(ctx));
  });
  r.get("/api/accounts/:id/structure", async (ctx) => {
    const { g, id, acc } = await accountCtx(ctx);
    const statuses = (ctx.url.searchParams.get("statuses") || "").split(",").filter(Boolean);
    const st = await structure(g, id, acc.currency, { statuses, force: force(ctx) });
    let metrics = {};
    let period = null;
    if (ctx.url.searchParams.get("metrics") !== "0") {
      period = periodFrom(ctx, acc.timezone);
      const q = { accountId: id, since: period.since, until: period.until, force: force(ctx) };
      const [c, a, d] = await Promise.all([
        insights(g, { ...q, level: "campaign" }),
        insights(g, { ...q, level: "adset" }),
        insights(g, { ...q, level: "ad" })
      ]);
      const goalOf = new Map(st.value.adsets.map((x) => [x.id, x.optimizationGoal]));
      const objOf = new Map(st.value.campaigns.map((x) => [x.id, x.objective]));
      [...c.value, ...a.value, ...d.value].forEach((row) => {
        metrics[row.id] = parseInsightRow({ ...row.raw, ...rawFromRow(row.m) }, row.adsetId ? goalOf.get(row.adsetId) : void 0, objOf.get(row.campaignId || row.id));
      });
      st.value.campaigns.forEach((cmp2) => {
        const rows = st.value.adsets.filter((x) => x.campaignId === cmp2.id).map((x) => metrics[x.id]).filter(Boolean);
        if (metrics[cmp2.id] && rows.length) {
          metrics[cmp2.id].results = rows.reduce((s, x) => s + x.results, 0);
          finalize(metrics[cmp2.id]);
        }
      });
    }
    return { account: acc, ...st.value, cachedAt: st.cachedAt, fromCache: st.fromCache, metrics, period };
  });
  r.get("/api/accounts/:id/report", async (ctx) => {
    const { g, acc } = await accountCtx(ctx);
    const sp = ctx.url.searchParams;
    const level = ["campaign", "adset", "ad"].includes(sp.get("level") || "") ? sp.get("level") : "campaign";
    return accountReport(g, acc, { period: sp.get("period") || "last_7d", since: sp.get("since") || void 0, until: sp.get("until") || void 0, level, kpi: sp.get("kpi") || "auto", force: force(ctx) });
  });
  r.get("/api/accounts/:id/whatsapp", async (ctx) => {
    const { g, id } = await accountCtx(ctx);
    return whatsappInfo(g, id, force(ctx));
  });
  r.get("/api/accounts/:id/audiences", async (ctx) => {
    const { g, id } = await accountCtx(ctx);
    return audiences(g, id, force(ctx));
  });
  r.post("/api/accounts/:id/audiences", async (ctx) => {
    const { g, id } = await accountCtx(ctx);
    const b = await ctx.json();
    const p = { name: String(b.name || "").trim(), description: b.description || void 0 };
    if (!p.name) throw new ApiError(400, "El p\xFAblico necesita un nombre.");
    const retention = Math.min(Math.max(Number(b.retentionDays) || 30, 1), b.kind === "engagement_page" || b.kind === "engagement_ig" ? 730 : 180);
    const rule = (source, event) => ({ inclusions: { operator: "or", rules: [{
      event_sources: [source],
      retention_seconds: retention * 86400,
      ...event ? { filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: event }] } } : {}
    }] } });
    switch (b.kind) {
      case "customer_list":
        p.subtype = "CUSTOM";
        p.customer_file_source = b.customerFileSource || "USER_PROVIDED_ONLY";
        break;
      case "website":
        p.subtype = "WEBSITE";
        if (!b.pixelId) throw new ApiError(400, "Elige el p\xEDxel.");
        p.rule = rule({ id: b.pixelId, type: "pixel" }, b.event || void 0);
        p.prefill = true;
        break;
      case "engagement_page":
        p.subtype = "ENGAGEMENT";
        if (!b.pageId) throw new ApiError(400, "Elige la p\xE1gina.");
        p.rule = rule({ id: b.pageId, type: "page" }, b.event || "page_engaged");
        p.prefill = true;
        break;
      case "engagement_ig":
        p.subtype = "ENGAGEMENT";
        if (!b.igId) throw new ApiError(400, "Elige la cuenta de Instagram.");
        p.rule = rule({ id: b.igId, type: "ig_business" }, b.event || "ig_business_profile_all");
        p.prefill = true;
        break;
      case "lookalike":
        p.subtype = "LOOKALIKE";
        if (!b.originId || !b.country) throw new ApiError(400, "Elige el p\xFAblico de origen y el pa\xEDs.");
        p.origin_audience_id = b.originId;
        p.lookalike_spec = { type: "custom_ratio", ratio: Math.min(Math.max(Number(b.ratio) || 0.01, 0.01), 0.2), country: String(b.country).toUpperCase() };
        break;
      default:
        throw new ApiError(400, "Tipo de p\xFAblico no admitido por la API.");
    }
    const res = await g.post(id + "/customaudiences", p);
    await audit({ user: ctx.user.email, action: "audience.create", result: "ok", accountId: id, level: "audience", entityId: res.id, entityName: p.name, meta: { kind: b.kind } });
    const { invalidate: invalidate2 } = await Promise.resolve().then(() => (init_store(), store_exports));
    await invalidate2("aud:" + id);
    return { id: res.id };
  }, { permission: "audiences" });
  r.post("/api/accounts/:id/audiences/:aid/users", async (ctx) => {
    const { g, id } = await accountCtx(ctx);
    const b = await ctx.json();
    const rows = (b.rows || []).slice(0, 1e4);
    if (!rows.length) throw new ApiError(400, "No hay filas para subir.");
    const norm = (s, kind) => {
      if (!s) return "";
      const v2 = kind === "email" ? s.trim().toLowerCase() : s.replace(/\D/g, "");
      return v2;
    };
    const data = await Promise.all(rows.map(async (x) => [x.email ? await sha256Hex(norm(x.email, "email")) : "", x.phone ? await sha256Hex(norm(x.phone, "phone")) : ""]));
    const res = await g.post(ctx.params.aid + "/users", { payload: { schema: ["EMAIL", "PHONE"], data } });
    await audit({ user: ctx.user.email, action: "audience.upload", result: "ok", accountId: id, level: "audience", entityId: ctx.params.aid, meta: { rows: rows.length, received: res.num_received, invalid: res.num_invalid_entries } });
    return res;
  }, { permission: "audiences" });
  r.get("/api/accounts/:id/events", async (ctx) => {
    const { g, id } = await accountCtx(ctx);
    const assets = (await accountAssets(g, id, force(ctx))).value;
    const waInfo = await whatsappInfo(g, id).then((x) => x.value).catch(() => null);
    const waUsed = new Map((waInfo?.datasets || []).filter((d) => d.sources.includes("CONJUNTOS")).map((d) => [d.id, d]));
    const waIds = /* @__PURE__ */ new Set([...assets.wabas.flatMap((w) => w.datasets.map((d) => d.id)), ...waUsed.keys()]);
    const allDs = [...assets.pixels.map((p) => ({ ...p, kind: waIds.has(p.id) ? "whatsapp" : "pixel", whatsappAdsets: waUsed.get(p.id)?.uses || 0 }))];
    assets.wabas.forEach((w) => w.datasets.forEach((d) => {
      if (!allDs.some((x) => x.id === d.id)) allDs.push({ id: d.id, name: d.name || "Dataset de " + w.name, kind: "whatsapp", lastFiredTime: null });
    }));
    const detail = await Promise.all(allDs.slice(0, 12).map(async (ds) => {
      const [st, q] = await Promise.all([pixelStats(g, ds.id, force(ctx)).then((x) => x.value).catch(() => null), datasetQuality(g, ds.id)]);
      const statsLast = (st?.events || []).map((e) => e.lastReceived).filter(Boolean).sort().pop() || null;
      const lastFiredTime = [ds.lastFiredTime, statsLast].filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
      return { ...ds, lastFiredTime, stats: st, quality: q, wabas: assets.wabas.filter((w) => w.datasets.some((d) => d.id === ds.id)).map((w) => ({ id: w.id, name: w.name })) };
    }));
    return {
      datasets: detail,
      customConversions: assets.customConversions,
      wabas: assets.wabas,
      warnings: assets.warnings,
      notes: [
        "La API de Conversiones Offline (offline_conversion_data_sets) se retir\xF3: los eventos offline y de CRM se env\xEDan al mismo dataset con Conversions API (action_source = physical_store / system_generated).",
        "Los eventos de WhatsApp se reciben en el dataset de la WABA con action_source = business_messaging.",
        "La fecha de \xFAltimo evento incluye los eventos de servidor (Conversions API). Meta solo informa last_fired_time para el p\xEDxel del navegador, as\xED que un dataset que recibe solo CAPI se revisa con sus estad\xEDsticas de 7 d\xEDas."
      ]
    };
  });
  r.get("/api/accounts/:id/insights", async (ctx) => {
    const { g, id, acc } = await accountCtx(ctx);
    const pr = periodFrom(ctx, acc.timezone);
    const level = ctx.url.searchParams.get("level") || "campaign";
    const breakdown = ctx.url.searchParams.get("breakdown") || "none";
    const ids = (ctx.url.searchParams.get("ids") || "").split(",").filter(Boolean);
    const res = await insights(g, { accountId: id, level, since: pr.since, until: pr.until, breakdown, ids, filterLevel: ctx.url.searchParams.get("filterLevel") || void 0, force: force(ctx) });
    return { ...res, period: pr, breakdown: BREAKDOWNS[breakdown], currency: acc.currency };
  });
  r.get("/api/accounts/:id/dashboard", async (ctx) => {
    const { g, id, acc } = await accountCtx(ctx);
    const pr = periodFrom(ctx, acc.timezone);
    return dashboardFor(g, id, acc.currency, pr, force(ctx));
  });
  r.get("/api/overview", async (ctx) => {
    const g = await graph();
    const allowed = await allowedAccounts(ctx);
    const accs = (await adAccounts(g)).value.filter((a) => a.status === 1 && (!allowed || allowed.includes(a.id)));
    const ids = (ctx.url.searchParams.get("ids") || "").split(",").filter(Boolean);
    const pick2 = (ids.length ? accs.filter((a) => ids.includes(a.id)) : accs).slice(0, 40);
    const rows = await Promise.all(pick2.map(async (a) => {
      try {
        const pr = periodFrom(ctx, a.timezone);
        const d = await dashboardFor(g, a.id, a.currency, pr, force(ctx), false);
        return { account: a, totals: d.totals, previous: d.previous, period: pr };
      } catch (e) {
        return { account: a, error: e.info?.message || e.message };
      }
    }));
    return { rows, syncedAt: (/* @__PURE__ */ new Date()).toISOString() };
  });
  r.get("/api/search/geo", async (ctx) => {
    const g = await graph();
    const q = ctx.url.searchParams.get("q") || "";
    const types = (ctx.url.searchParams.get("types") || "country,region,city").split(",");
    if (q.length < 2) return { data: [] };
    return cached("geo:" + q + ":" + types.join(","), 86400, async () => (await g.get("search", { type: "adgeolocation", q, location_types: types, limit: 25 })).data || []).then((x) => ({ data: x.value }));
  });
  r.get("/api/search/locales", async (ctx) => {
    const g = await graph();
    const q = ctx.url.searchParams.get("q") || "";
    return cached("loc:" + q, 86400, async () => (await g.get("search", { type: "adlocale", q, limit: 25 })).data || []).then((x) => ({ data: x.value }));
  });
  r.get("/api/search/interests", async (ctx) => {
    const g = await graph();
    const q = ctx.url.searchParams.get("q") || "";
    if (q.length < 2) return { data: [] };
    return cached("int:" + q, 86400, async () => (await g.get("search", { type: "adinterest", q, limit: 25 })).data || []).then((x) => ({ data: x.value }));
  });
  r.get("/api/pages/:id/forms", async (ctx) => {
    await ensurePageAccess(ctx, ctx.params.id);
    const g = await graph();
    const tk = await pageToken(g, ctx.params.id);
    const forms = await new Graph(tk).all(ctx.params.id + "/leadgen_forms", { fields: "id,name,status,leads_count,created_time,locale" }, 5);
    return { data: forms.map((f) => ({ ...f, pageId: ctx.params.id })) };
  });
  r.get("/api/forms/:id/leads", async (ctx) => {
    const g = await graph();
    const pageId = ctx.url.searchParams.get("pageId");
    if (!pageId) throw new ApiError(400, "Falta pageId.");
    await ensurePageAccess(ctx, pageId);
    const tk = await pageToken(g, pageId);
    const forms = await new Graph(tk).all(pageId + "/leadgen_forms", { fields: "id" }, 5).catch(() => []);
    if (!forms.some((f) => String(f.id) === ctx.params.id)) throw new ApiError(403, "El formulario no pertenece a esa p\xE1gina.");
    const since = ctx.url.searchParams.get("since");
    const params = { fields: "id,created_time,ad_id,ad_name,campaign_name,form_id,field_data,platform" };
    if (since) params.filtering = [{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(Date.parse(since) / 1e3) }];
    const leads = await new Graph(tk).all(ctx.params.id + "/leads", params, 20);
    await audit({ user: ctx.user.email, action: "leads.download", result: "ok", entityId: ctx.params.id, level: "meta", meta: { count: leads.length, pageId } });
    return { data: leads };
  }, { permission: "audiences" });
  r.post("/api/accounts/:id/images", async (ctx) => {
    const { g, id } = await accountCtx(ctx);
    const b = await ctx.json();
    if (!b.bytes) throw new ApiError(400, "Falta la imagen.");
    if (String(b.bytes).length > 55e5) throw new ApiError(413, "La imagen supera ~4 MB. Compr\xEDmela antes de subirla.");
    const res = await g.post(id + "/adimages", { bytes: b.bytes, name: b.name || "imagen" });
    const img = Object.values(res.images || {})[0];
    return { hash: img?.hash, url: img?.url };
  }, { permission: "create" });
  r.post("/api/sync", async (ctx) => {
    const b = await ctx.json().catch(() => ({}));
    const g = await graph();
    if (b.accountId) {
      const id = await ensureAccountAccess(ctx, b.accountId);
      await invalidateAccount(id);
      const { invalidate: invalidate2 } = await Promise.resolve().then(() => (init_store(), store_exports));
      await Promise.all([invalidate2("assets:" + id), invalidate2("aud:" + id), invalidate2("wa:" + id)]);
    }
    const accs = await adAccounts(g, true);
    const at = (/* @__PURE__ */ new Date()).toISOString();
    await kv("core").set("sync/" + (b.accountId || "accounts"), { at, by: ctx.user.email });
    return { ok: true, at, accounts: accs.value.length };
  });
  r.get("/api/sync/status", async (ctx) => {
    const acc = ctx.url.searchParams.get("accountId");
    const [a, b] = await Promise.all([kv("core").get("sync/accounts"), acc ? kv("core").get("sync/" + acc) : null]);
    const bg = await kv("core").get("sync/background");
    return { accounts: a, account: b, background: bg };
  });
}
function rawFromRow(m) {
  return { spend: m.spend, impressions: m.impressions, reach: m.reach, clicks: m.clicks, inline_link_clicks: m.linkClicks, frequency: m.frequency, ctr: m.ctr, cpc: m.cpc, cpm: m.cpm };
}
async function dashboardFor(g, id, currency, pr, forceRefresh, withDetail = true) {
  const base = { accountId: id, force: forceRefresh };
  const [cur, prev] = await Promise.all([
    insights(g, { ...base, level: "account", since: pr.since, until: pr.until }),
    insights(g, { ...base, level: "account", since: pr.prevSince, until: pr.prevUntil })
  ]);
  const totals = sumMetrics(cur.value.map((r) => r.m));
  const previous = sumMetrics(prev.value.map((r) => r.m));
  if (!withDetail) return { totals, previous, currency, period: pr, cachedAt: cur.cachedAt };
  const [daily, dailyPrev, camps] = await Promise.all([
    insights(g, { ...base, level: "account", since: pr.since, until: pr.until, breakdown: "day" }),
    insights(g, { ...base, level: "account", since: pr.prevSince, until: pr.prevUntil, breakdown: "day" }),
    insights(g, { ...base, level: "campaign", since: pr.since, until: pr.until })
  ]);
  return {
    totals,
    previous,
    currency,
    period: pr,
    cachedAt: cur.cachedAt,
    daily: daily.value.map((r) => ({ date: r.date, ...r.m })).sort((a, b) => String(a.date).localeCompare(String(b.date))),
    dailyPrevious: dailyPrev.value.map((r) => ({ date: r.date, ...r.m })).sort((a, b) => String(a.date).localeCompare(String(b.date))),
    campaigns: camps.value.map((r) => ({ id: r.id, name: r.name, ...r.m })).sort((a, b) => b.spend - a.spend)
  };
}

// server/routes/ops.ts
init_store();
init_assets();
init_entities();

// server/meta/duplicate.ts
init_assets();
init_entities();
async function readTree(g, level, ids) {
  const tree = { campaigns: [], adsets: [], ads: [] };
  for (const id of ids) {
    if (level === "campaign") {
      const c = await g.get(id, { fields: CAMPAIGN_FIELDS + ",account_id" });
      tree.campaigns.push(c);
      (await g.all(id + "/adsets", { fields: ADSET_FIELDS }, 10)).forEach((x) => tree.adsets.push(x));
      (await g.all(id + "/ads", { fields: AD_FIELDS }, 20)).forEach((x) => tree.ads.push(x));
    } else if (level === "adset") {
      const a = await g.get(id, { fields: ADSET_FIELDS });
      tree.adsets.push(a);
      (await g.all(id + "/ads", { fields: AD_FIELDS }, 20)).forEach((x) => tree.ads.push(x));
    } else tree.ads.push(await g.get(id, { fields: AD_FIELDS }));
  }
  return tree;
}
function collectAssets(tree) {
  const m = /* @__PURE__ */ new Map();
  const add3 = (type, id, by, name, auto) => {
    if (!id) return;
    const k = type + ":" + id;
    const cur = m.get(k) || { type, id: String(id), name, usedBy: [], auto };
    if (!cur.usedBy.includes(by)) cur.usedBy.push(by);
    m.set(k, cur);
  };
  tree.adsets.forEach((a) => {
    const po = a.promoted_object || {};
    add3("page", po.page_id, a.name);
    add3("pixel", po.pixel_id, a.name);
    add3("whatsapp_number", po.whatsapp_phone_number, a.name);
    add3("custom_conversion", po.custom_conversion_id, a.name);
    add3("catalog", po.product_catalog_id, a.name);
    add3("application", po.application_id, a.name);
    (a.targeting?.custom_audiences || []).forEach((x) => add3("audience", x.id, a.name, x.name));
    (a.targeting?.excluded_custom_audiences || []).forEach((x) => add3("audience", x.id, a.name, x.name));
  });
  tree.ads.forEach((ad) => {
    const c = ad.creative || {};
    const oss = c.object_story_spec || {};
    add3("page", oss.page_id, ad.name);
    add3("instagram", oss.instagram_user_id, ad.name);
    const ld = oss.link_data || {}, vd = oss.video_data || {};
    add3("image", ld.image_hash, ad.name, void 0, true);
    add3("video", vd.video_id, ad.name, void 0, true);
    add3("lead_form", (ld.call_to_action || vd.call_to_action || {}).value?.lead_gen_form_id, ad.name);
    (c.asset_feed_spec?.images || []).forEach((i) => add3("image", i.hash, ad.name, void 0, true));
    (c.asset_feed_spec?.videos || []).forEach((v2) => add3("video", v2.video_id, ad.name, void 0, true));
  });
  return m;
}
async function analyzeDuplicate(g, level, ids, targetAccountId) {
  const tree = await readTree(g, level, ids);
  const refs = collectAssets(tree);
  const target = actId(targetAccountId);
  const [assets, auds] = await Promise.all([accountAssets(g, target), audiences(g, target)]);
  const A = assets.value, AU = auds.value;
  const out = [];
  for (const r of refs.values()) {
    let candidates = [];
    let available = false;
    switch (r.type) {
      case "page":
        candidates = A.pages.map((p) => ({ id: p.id, name: p.name }));
        break;
      case "instagram":
        candidates = A.instagram.map((i) => ({ id: i.id, name: "@" + (i.username || i.id) }));
        break;
      case "pixel":
        candidates = [...A.pixels.map((p) => ({ id: p.id, name: p.name })), ...A.wabas.flatMap((w) => w.datasets.map((d) => ({ id: d.id, name: "Dataset WhatsApp \xB7 " + w.name })))];
        break;
      case "whatsapp_number":
        candidates = A.wabas.flatMap((w) => w.numbers.map((n2) => ({ id: n2.display, name: `${n2.display} \xB7 ${n2.verifiedName || w.name}` })));
        break;
      case "audience":
        candidates = AU.custom.map((x) => ({ id: x.id, name: x.name }));
        break;
      case "custom_conversion":
        candidates = A.customConversions.map((c) => ({ id: c.id, name: c.name }));
        break;
      case "catalog":
        candidates = A.catalogs.map((c) => ({ id: c.id, name: c.name }));
        break;
      default:
        candidates = [];
    }
    if (r.type === "whatsapp_number") available = candidates.some((c) => c.id.replace(/\D/g, "") === r.id.replace(/\D/g, ""));
    else if (r.type === "lead_form") available = true;
    else available = candidates.some((c) => c.id === r.id);
    const name = r.name || candidates.find((c) => c.id === r.id)?.name;
    let suggested;
    if (!available && r.type === "audience" && r.name) suggested = candidates.find((c) => c.name.toLowerCase() === r.name.toLowerCase())?.id;
    if (!available && candidates.length === 1 && ["page", "instagram", "catalog"].includes(r.type)) suggested = candidates[0].id;
    out.push({ ...r, name, availableInTarget: r.auto ? false : available, candidates, suggested });
  }
  return {
    tree: { campaigns: tree.campaigns.length, adsets: tree.adsets.length, ads: tree.ads.length },
    assets: out.sort((a, b) => Number(a.availableInTarget) - Number(b.availableInTarget)),
    blocking: out.filter((r) => !r.availableInTarget && !r.auto && !r.suggested).length
  };
}
var pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== void 0 && o[k] !== null).map((k) => [k, o[k]]));
function remapAdset(a, map, campaignId, statusOption, suffix) {
  const p = pick(a, ["optimization_goal", "billing_event", "bid_amount", "bid_strategy", "daily_budget", "lifetime_budget", "destination_type", "attribution_spec", "end_time"]);
  p.name = a.name + suffix;
  p.campaign_id = campaignId;
  p.status = statusOption === "INHERITED_FROM_SOURCE" ? a.status : statusOption;
  if (a.start_time && Date.parse(a.start_time) > Date.now()) p.start_time = a.start_time;
  if (p.end_time && Date.parse(p.end_time) < Date.now()) delete p.end_time;
  const po = { ...a.promoted_object || {} };
  for (const k of ["page_id", "pixel_id", "custom_conversion_id", "product_catalog_id", "application_id"]) if (po[k] && map[po[k]] !== void 0) po[k] = map[po[k]];
  if (po.whatsapp_phone_number && map[po.whatsapp_phone_number] !== void 0) po.whatsapp_phone_number = map[po.whatsapp_phone_number];
  Object.keys(po).forEach((k) => {
    if (po[k] === "" || po[k] === null) delete po[k];
  });
  if (Object.keys(po).length) p.promoted_object = po;
  const t = JSON.parse(JSON.stringify(a.targeting || {}));
  const remapAud = (l) => (l || []).map((x) => ({ id: map[x.id] ?? x.id })).filter((x) => x.id);
  if (t.custom_audiences) t.custom_audiences = remapAud(t.custom_audiences);
  if (t.excluded_custom_audiences) t.excluded_custom_audiences = remapAud(t.excluded_custom_audiences);
  p.targeting = t;
  return p;
}
function remapCreative(c, map, name) {
  const p = { name };
  if (c.url_tags) p.url_tags = c.url_tags;
  if (c.degrees_of_freedom_spec) p.degrees_of_freedom_spec = c.degrees_of_freedom_spec;
  if (c.object_story_spec) {
    const oss = JSON.parse(JSON.stringify(c.object_story_spec));
    if (oss.page_id && map[oss.page_id] !== void 0) oss.page_id = map[oss.page_id];
    if (oss.instagram_user_id && map[oss.instagram_user_id] !== void 0) oss.instagram_user_id = map[oss.instagram_user_id] || void 0;
    if (!oss.instagram_user_id) delete oss.instagram_user_id;
    if (oss.link_data?.image_hash && map["img:" + oss.link_data.image_hash]) oss.link_data.image_hash = map["img:" + oss.link_data.image_hash];
    if (oss.video_data?.video_id && map["vid:" + oss.video_data.video_id]) oss.video_data.video_id = map["vid:" + oss.video_data.video_id];
    if (oss.video_data?.image_hash && map["img:" + oss.video_data.image_hash]) oss.video_data.image_hash = map["img:" + oss.video_data.image_hash];
    p.object_story_spec = oss;
  } else if (c.object_story_id || c.effective_object_story_id) p.object_story_id = c.object_story_id || c.effective_object_story_id;
  if (c.asset_feed_spec) {
    const afs = JSON.parse(JSON.stringify(c.asset_feed_spec));
    (afs.images || []).forEach((i) => {
      if (map["img:" + i.hash]) i.hash = map["img:" + i.hash];
    });
    (afs.videos || []).forEach((v2) => {
      if (map["vid:" + v2.video_id]) v2.video_id = map["vid:" + v2.video_id];
    });
    p.asset_feed_spec = afs;
  }
  return p;
}
async function migrateMedia(g, sourceAccountId, targetAccountId, refs) {
  const map = {};
  const errors = [];
  const src = actId(sourceAccountId).replace("act_", ""), dst = actId(targetAccountId);
  for (const r of refs.filter((x) => x.type === "image")) {
    try {
      const res = await g.post(dst + "/adimages", { copy_from: { source_account_id: src, hash: r.id } });
      const img = Object.values(res.images || {})[0];
      if (img?.hash) map["img:" + r.id] = img.hash;
    } catch (e) {
      errors.push(`Imagen ${r.id}: ${e.info?.message || e.message}`);
    }
  }
  for (const r of refs.filter((x) => x.type === "video")) {
    try {
      const v2 = await g.get(r.id, { fields: "source,title" });
      if (!v2.source) throw new Error("Meta no expone la URL del video (permiso o video de p\xE1gina).");
      const res = await g.post(dst + "/advideos", { file_url: v2.source, name: v2.title || "Copia " + r.id });
      if (res.id) map["vid:" + r.id] = res.id;
    } catch (e) {
      errors.push(`Video ${r.id}: ${e.info?.message || e.message}`);
    }
  }
  return { map, errors };
}

// server/routes/ops.ts
init_errors();

// shared/meta/spec.ts
init_currency();
function attributionSpec(k) {
  switch (k) {
    case "7d_click":
      return [{ event_type: "CLICK_THROUGH", window_days: 7 }];
    case "1d_click":
      return [{ event_type: "CLICK_THROUGH", window_days: 1 }];
    case "1d_click_1d_view":
      return [{ event_type: "CLICK_THROUGH", window_days: 1 }, { event_type: "VIEW_THROUGH", window_days: 1 }];
    default:
      return [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }];
  }
}
function campaignPayload(c, currency) {
  const p = {
    name: c.name.trim(),
    objective: c.objective,
    status: c.status,
    buying_type: c.buyingType || "AUCTION",
    special_ad_categories: c.specialAdCategories || []
    /* se envía aunque vaya vacío: Meta lo exige */
  };
  if (c.specialAdCategories?.length && c.specialAdCategoryCountry?.length) p.special_ad_category_country = c.specialAdCategoryCountry;
  if (c.budgetMode === "CBO") {
    const v2 = toMinor(c.budget, currency);
    if (c.budgetType === "lifetime") p.lifetime_budget = v2;
    else p.daily_budget = v2;
    p.bid_strategy = c.bidStrategy || "LOWEST_COST_WITHOUT_CAP";
  } else {
    p.is_adset_budget_sharing_enabled = !!c.budgetSharing;
  }
  if (c.spendCap) p.spend_cap = toMinor(c.spendCap, currency);
  if (c.startTime) p.start_time = c.startTime;
  if (c.stopTime) p.stop_time = c.stopTime;
  return p;
}
function destinationTypeFor(a, objective) {
  const d = findDestination(objective, a.destination);
  if (!d?.destinationType) return void 0;
  if (d.key === "ON_AD" && objective === "OUTCOME_ENGAGEMENT") {
    return ["THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"].includes(a.optimizationGoal) ? "ON_VIDEO" : "ON_POST";
  }
  return d.destinationType;
}
function promotedObjectFor(a, objective) {
  const goal = findGoal(objective, a.destination, a.optimizationGoal);
  const req = new Set(goal?.requires || []);
  const po = {};
  const needsPage = ["WHATSAPP", "MESSENGER", "INSTAGRAM_DIRECT", "MESSAGING_APPS", "INSTANT_FORM", "CALLS", "ON_PAGE"].includes(a.destination) || a.destination === "ON_AD" && objective === "OUTCOME_ENGAGEMENT" || req.has("page");
  if (needsPage && a.pageId) po.page_id = a.pageId;
  if (a.destination === "WHATSAPP" && a.whatsappNumber) po.whatsapp_phone_number = normalizePhone(a.whatsappNumber);
  if (req.has("pixel") || req.has("whatsappDataset")) {
    if (a.pixelId) po.pixel_id = a.pixelId;
    if (req.has("conversionEvent") || a.customEventType) {
      if (a.customConversionId) {
        po.custom_conversion_id = a.customConversionId;
        po.custom_event_type = a.customEventType || "OTHER";
      } else if (a.customEventType) po.custom_event_type = a.customEventType;
    }
  }
  if (req.has("app")) {
    if (a.appId) po.application_id = a.appId;
    if (a.appStoreUrl) po.object_store_url = a.appStoreUrl;
  }
  return Object.keys(po).length ? po : void 0;
}
function normalizePhone(s) {
  const d = String(s || "").replace(/[^0-9]/g, "");
  return d ? "+" + d : "";
}
function targetingPayload(t, p, a) {
  const geo = {};
  if (t.countries?.length) geo.countries = t.countries;
  if (t.regions?.length) geo.regions = t.regions.map((r) => ({ key: r.key }));
  if (t.cities?.length) geo.cities = t.cities.map((c) => {
    const o = { key: c.key };
    if (c.radius) {
      o.radius = c.radius;
      o.distance_unit = c.distance_unit || "kilometer";
    }
    return o;
  });
  if (t.zips?.length) geo.zips = t.zips.map((z) => ({ key: z.key }));
  if (t.customLocations?.length) geo.custom_locations = t.customLocations.map((l) => ({ latitude: l.latitude, longitude: l.longitude, radius: l.radius, distance_unit: l.distance_unit }));
  const out = { geo_locations: geo };
  const ex = {};
  if (t.excludedRegions?.length) ex.regions = t.excludedRegions.map((r) => ({ key: r.key }));
  if (t.excludedCities?.length) ex.cities = t.excludedCities.map((c) => ({ key: c.key }));
  if (Object.keys(ex).length) out.excluded_geo_locations = ex;
  if (t.advantageAudience) {
    out.age_min = Math.min(Math.max(t.ageMin || 18, 18), 25);
    if (t.ageMin !== 18 || t.ageMax !== 65) out.age_range = [t.ageMin || 18, t.ageMax || 65];
    out.targeting_automation = { advantage_audience: 1 };
  } else {
    out.age_min = t.ageMin || 18;
    out.age_max = t.ageMax || 65;
    out.targeting_automation = { advantage_audience: 0 };
  }
  if (t.genders === "male") out.genders = [1];
  if (t.genders === "female") out.genders = [2];
  if (t.locales?.length) out.locales = t.locales.map((l) => l.key);
  if (t.customAudiences?.length) out.custom_audiences = t.customAudiences.map((x) => ({ id: x.id }));
  if (t.excludedCustomAudiences?.length) out.excluded_custom_audiences = t.excludedCustomAudiences.map((x) => ({ id: x.id }));
  if (t.interests?.length) out.flexible_spec = [{ interests: t.interests.map((x) => ({ id: x.id, name: x.name })) }];
  if (p.mode === "manual") {
    out.publisher_platforms = p.publisherPlatforms;
    const clean = (k, arr) => (arr || []).filter((x) => !(RETIRED_POSITIONS[k] || []).includes(x));
    const setPos = (k, arr) => {
      const v2 = clean(k, arr);
      if (v2.length) out[k] = v2;
    };
    if (p.publisherPlatforms.includes("facebook") && p.facebookPositions.length) setPos("facebook_positions", p.facebookPositions);
    if (p.publisherPlatforms.includes("instagram") && p.instagramPositions.length) setPos("instagram_positions", p.instagramPositions);
    if (p.publisherPlatforms.includes("messenger") && p.messengerPositions.length) setPos("messenger_positions", p.messengerPositions);
    if (p.publisherPlatforms.includes("audience_network") && p.audienceNetworkPositions.length) out.audience_network_positions = p.audienceNetworkPositions;
    if (p.devicePlatforms?.length && p.devicePlatforms.length < 2) out.device_platforms = p.devicePlatforms;
  }
  void a;
  return out;
}
function adsetPayload(a, c, currency, campaignId) {
  const p = {
    name: a.name.trim(),
    campaign_id: campaignId,
    status: a.status,
    optimization_goal: a.optimizationGoal,
    billing_event: a.billingEvent || "IMPRESSIONS",
    targeting: targetingPayload(a.targeting, a.placements, a)
  };
  const dt = destinationTypeFor(a, c.objective);
  if (dt) p.destination_type = dt;
  const po = promotedObjectFor(a, c.objective);
  if (po) p.promoted_object = po;
  if (c.budgetMode === "ABO") {
    const v2 = toMinor(a.budget, currency);
    if (a.budgetType === "lifetime") p.lifetime_budget = v2;
    else p.daily_budget = v2;
    p.bid_strategy = c.bidStrategy || "LOWEST_COST_WITHOUT_CAP";
  }
  const strat = c.bidStrategy || "LOWEST_COST_WITHOUT_CAP";
  if ((strat === "COST_CAP" || strat === "LOWEST_COST_WITH_BID_CAP") && a.bidAmount) p.bid_amount = toMinor(a.bidAmount, currency);
  if (strat === "LOWEST_COST_WITH_MIN_ROAS" && a.roasFloor) p.bid_constraints = { roas_average_floor: Math.round(a.roasFloor * 1e4) };
  if (a.startTime) p.start_time = a.startTime;
  if (a.endTime) p.end_time = a.endTime;
  if (["OFFSITE_CONVERSIONS", "VALUE"].includes(a.optimizationGoal)) p.attribution_spec = attributionSpec(a.attribution);
  if (a.reference && a.reference.objective === c.objective) applyReference(p, a, a.reference);
  return p;
}
function applyReference(p, a, r) {
  p.optimization_goal = a.optimizationGoal || r.optimizationGoal;
  if (r.destinationType) p.destination_type = r.destinationType;
  p.billing_event = r.billingEvent || p.billing_event;
  if (r.optimizationSubEvent) p.optimization_sub_event = r.optimizationSubEvent;
  const po = {};
  for (const [k, v2] of Object.entries(r.promotedObject || {})) if (v2 !== null && v2 !== void 0 && v2 !== "") po[k] = v2;
  if (a.pageId) po.page_id = a.pageId;
  if (a.whatsappNumber) po.whatsapp_phone_number = normalizePhone(a.whatsappNumber);
  if (a.pixelId && (po.pixel_id || a.customEventType)) po.pixel_id = a.pixelId;
  if (a.customEventType && po.pixel_id) po.custom_event_type = a.customEventType;
  if (Object.keys(po).length) p.promoted_object = po;
  if (Array.isArray(r.attributionSpec) && r.attributionSpec.length) p.attribution_spec = r.attributionSpec;
}
var WA_LINK = "https://api.whatsapp.com/send";
function creativePayload(ad, a, objective) {
  const name = (ad.name || "Creativo") + " \xB7 " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (ad.format === "existing_post" && ad.existingPostId) {
    const p2 = { name, object_story_id: ad.existingPostId };
    if (ad.urlTags) p2.url_tags = ad.urlTags;
    return p2;
  }
  const dest = a.destination;
  const cta = { type: ad.cta || "LEARN_MORE" };
  let link = ad.link;
  if (dest === "WHATSAPP") {
    cta.type = "WHATSAPP_MESSAGE";
    cta.value = { app_destination: "WHATSAPP" };
    link = WA_LINK;
  } else if (dest === "MESSENGER" || dest === "MESSAGING_APPS") {
    cta.type = "MESSAGE_PAGE";
    cta.value = { app_destination: dest === "MESSENGER" ? "MESSENGER" : "MESSAGING_APPS" };
    link = link || "https://fb.com/messenger_doc/";
  } else if (dest === "INSTAGRAM_DIRECT") {
    cta.type = "INSTAGRAM_MESSAGE";
    cta.value = { app_destination: "INSTAGRAM_DIRECT" };
    link = link || "https://www.instagram.com";
  } else if (dest === "INSTANT_FORM") {
    cta.value = { lead_gen_form_id: ad.leadFormId, link: "http://fb.me/" };
    link = "http://fb.me/";
  } else if (dest === "CALLS") {
    cta.type = "CALL_NOW";
    cta.value = { link: "tel:" + String(a.phoneNumber || "").replace(/[^0-9+]/g, "") };
    link = link || "https://www.facebook.com";
  } else if (cta.type !== "NO_BUTTON") cta.value = { link };
  const spec = { page_id: a.pageId };
  if (a.instagramUserId) spec.instagram_user_id = a.instagramUserId;
  if (ad.format === "video" && ad.videoId) {
    spec.video_data = {
      video_id: ad.videoId,
      message: ad.primaryText || "",
      title: ad.headline || "",
      link_description: ad.description || "",
      call_to_action: cta.type === "NO_BUTTON" ? void 0 : { ...cta, value: { ...cta.value || {}, link: cta.value?.link || link } }
    };
    if (ad.thumbnailUrl) spec.video_data.image_url = ad.thumbnailUrl;
  } else {
    spec.link_data = { link, message: ad.primaryText || "", name: ad.headline || "", description: ad.description || "" };
    if (cta.type !== "NO_BUTTON") spec.link_data.call_to_action = cta;
    if (ad.imageHash) spec.link_data.image_hash = ad.imageHash;
    else if (ad.imageUrl) spec.link_data.picture = ad.imageUrl;
    if (ad.displayLink) spec.link_data.caption = ad.displayLink;
    const welcome = whatsappWelcome(ad, dest);
    if (welcome) spec.link_data.page_welcome_message = welcome;
  }
  if (spec.video_data) {
    const w = whatsappWelcome(ad, dest);
    if (w) spec.video_data.page_welcome_message = w;
  }
  const p = { name, object_story_spec: spec };
  if (ad.urlTags && dest !== "WHATSAPP" && dest !== "INSTANT_FORM") p.url_tags = ad.urlTags;
  void objective;
  return p;
}
function whatsappWelcome(ad, dest) {
  if (dest !== "WHATSAPP" || !ad.whatsappGreeting && !ad.whatsappAutofill) return void 0;
  return JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: { customer_action_type: "autofill_message", message: {
      text: ad.whatsappGreeting || "\xA1Hola! \xBFC\xF3mo podemos ayudarte?",
      autofill_message: { content: ad.whatsappAutofill || "Hola, quiero m\xE1s informaci\xF3n." }
    } }
  });
}
function adPayload(ad, adsetId, creativeId) {
  return { name: ad.name.trim(), adset_id: adsetId, creative: { creative_id: creativeId }, status: ad.status };
}

// server/meta/publish.ts
init_assets();
init_errors();
init_whatsapp();
var VALIDATE = { execution_options: ["validate_only"] };
function errInfo(e) {
  return e instanceof MetaApiError ? e.info : { message: String(e?.message || e) };
}
function errText2(e) {
  const i = errInfo(e);
  return [i.userTitle, i.userMessage || i.message].filter(Boolean).join(": ") + (i.code ? ` [${i.code}${i.subcode ? "/" + i.subcode : ""}]` : "") + (i.blameFields?.length ? " \xB7 campo: " + i.blameFields.join(", ") : "");
}
async function hostCampaigns(g, act) {
  const list2 = await g.all(act + "/campaigns", {
    fields: "id,name,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories",
    filtering: [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED"] }],
    limit: 200
  }, 3).catch(() => []);
  return list2.filter((c) => !(c.special_ad_categories || []).filter((x) => x && x !== "NONE").length && (!c.bid_strategy || c.bid_strategy === "LOWEST_COST_WITHOUT_CAP"));
}
async function verifyDraft(g, d, currency, opts = {}) {
  const act = actId(d.accountId);
  const items = [];
  const temps = {};
  const deleted = [];
  const cp = campaignPayload(d.campaign, currency);
  try {
    await g.post(act + "/campaigns", { ...cp, ...VALIDATE });
    items.push({ scope: "campaign", name: d.campaign.name, status: "ok", message: "Meta acepta la campa\xF1a.", payload: cp });
  } catch (e) {
    items.push({ scope: "campaign", name: d.campaign.name, status: "error", message: errText2(e), meta: errInfo(e), payload: cp });
  }
  const hosts = await hostCampaigns(g, act);
  const cbo = d.campaign.budgetMode === "CBO";
  const hostFor = async (objective, prefer) => {
    const ref = prefer ? hosts.find((h) => h.id === prefer && h.objective === objective) : void 0;
    if (ref) return { id: ref.id, cbo: !!(Number(ref.daily_budget) || Number(ref.lifetime_budget)) };
    const same = hosts.filter((h) => h.objective === objective);
    const pick2 = same.find((h) => !!(Number(h.daily_budget) || Number(h.lifetime_budget)) === cbo) || same[0];
    if (pick2) return { id: pick2.id, cbo: !!(Number(pick2.daily_budget) || Number(pick2.lifetime_budget)) };
    if (!opts.allowTemp) return null;
    if (!temps[objective]) {
      const tc = { ...d.campaign, name: "PMOS \xB7 validaci\xF3n temporal (se elimina sola)", objective, status: "PAUSED", budgetMode: "ABO", budget: null, bidStrategy: "LOWEST_COST_WITHOUT_CAP", specialAdCategories: [], specialAdCategoryCountry: [], budgetSharing: false, startTime: void 0, stopTime: void 0 };
      const r = await g.post(act + "/campaigns", campaignPayload(tc, currency));
      temps[objective] = r.id;
    }
    return { id: temps[objective], cbo: false };
  };
  const tryAdset = async (a, campaign) => {
    const host = await hostFor(campaign.objective, a.reference?.campaignId);
    if (!host) return { skipped: true };
    const spec = { ...campaign, budgetMode: host.cbo ? "CBO" : "ABO" };
    const budget = Math.max(a.budget || 0, (opts.minDaily || 0) * 1.5, 100);
    const p = adsetPayload({ ...a, budget, budgetType: "daily", startTime: void 0, endTime: void 0 }, spec, currency, host.id);
    await g.post(act + "/adsets", { ...p, ...VALIDATE });
    return { skipped: false, payload: p };
  };
  for (const a of d.adsets) {
    const full = adsetPayload(a, d.campaign, currency, "<campa\xF1a nueva>");
    try {
      const r = await tryAdset(a, d.campaign);
      if (r.skipped) items.push({
        scope: "adset",
        tmpId: a.tmpId,
        name: a.name,
        status: "skipped",
        payload: full,
        message: `No hay en la cuenta una campa\xF1a de ${OBJECTIVE_BY_KEY[d.campaign.objective]?.label} donde probar el conjunto sin crear nada. Activa "Permitir campa\xF1a temporal" o se validar\xE1 al publicar.`
      });
      else items.push({ scope: "adset", tmpId: a.tmpId, name: a.name, status: "ok", message: "Meta acepta el conjunto (destino, optimizaci\xF3n, objeto promovido y segmentaci\xF3n).", payload: full });
    } catch (e) {
      const item = { scope: "adset", tmpId: a.tmpId, name: a.name, status: "error", message: errText2(e), meta: errInfo(e), payload: full };
      const info = errInfo(e);
      if (["WHATSAPP", "MESSENGER", "INSTAGRAM_DIRECT"].includes(a.destination) && (info.subcode === 2490408 || info.category === "incompatible_config") && info.subcode !== 2446886) {
        item.alternatives = [];
        let configs = [];
        if (a.destination === "WHATSAPP") configs = (await whatsappInfo(g, d.accountId).catch(() => null))?.value.configs || [];
        const alts = [...referenceAlternatives(configs, a), ...alternativesFor(a, d.campaign)].slice(0, 6);
        for (const alt of alts) {
          try {
            await tryAdset({ ...a, destination: alt.destination, optimizationGoal: alt.optimizationGoal, billingEvent: alt.reference?.billingEvent || "IMPRESSIONS", customEventType: alt.customEventType || a.customEventType, reference: alt.reference }, { ...d.campaign, objective: alt.objective });
            item.alternatives.push({ ...alt, accepted: true });
          } catch (e2) {
            item.alternatives.push({ ...alt, accepted: false, error: errText2(e2) });
          }
        }
      }
      items.push(item);
    }
  }
  for (const ad of d.ads.slice(0, 6)) {
    const a = d.adsets.find((x) => x.tmpId === ad.adsetTmpId);
    if (!a) continue;
    const cr = creativePayload(ad, a, d.campaign.objective);
    try {
      const spec = cr.object_story_id ? { object_story_id: cr.object_story_id } : { object_story_spec: cr.object_story_spec };
      await g.get(act + "/generatepreviews", { ad_format: "MOBILE_FEED_STANDARD", creative: spec });
      items.push({ scope: "ad", tmpId: ad.tmpId, name: ad.name, status: "ok", message: "Meta genera la vista previa del creativo.", payload: cr });
    } catch (e) {
      items.push({ scope: "ad", tmpId: ad.tmpId, name: ad.name, status: "error", message: errText2(e), meta: errInfo(e), payload: cr });
    }
  }
  if (d.ads.length > 6) items.push({ scope: "ad", name: `${d.ads.length - 6} anuncios m\xE1s`, status: "skipped", message: "Se validan con las reglas internas; Meta los revisa al publicar." });
  for (const id of Object.values(temps)) {
    try {
      await g.del(id);
      deleted.push(id);
    } catch {
    }
  }
  return { items, tempCampaignsDeleted: deleted };
}
function toReference(c) {
  return {
    adsetId: c.adsetId,
    adsetName: c.adsetName,
    campaignId: c.campaignId,
    campaignName: c.campaignName,
    objective: c.objective,
    optimizationGoal: c.optimizationGoal,
    destinationType: c.destinationType,
    billingEvent: c.billingEvent,
    optimizationSubEvent: c.optimizationSubEvent,
    promotedObject: c.promotedObject,
    attributionSpec: c.attributionSpec
  };
}
function referenceAlternatives(configs, a) {
  const purchaseIntent = ["MESSAGING_PURCHASE_CONVERSION", "OFFSITE_CONVERSIONS", "VALUE"].includes(a.optimizationGoal);
  const seen = /* @__PURE__ */ new Set();
  return configs.filter((c) => (purchaseIntent ? c.purchase : true) && c.objective).filter((c) => {
    const k = c.objective + c.optimizationGoal + c.destinationType + (c.optimizationSubEvent || "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3).map((c) => ({
    objective: c.objective,
    destination: "WHATSAPP",
    optimizationGoal: c.optimizationGoal,
    label: `Como \u201C${c.adsetName}\u201D (ya funciona en la cuenta: ${OBJECTIVE_BY_KEY[c.objective]?.label || c.objective} \xB7 ${c.optimizationGoal})`,
    customEventType: c.promotedObject?.custom_event_type,
    reference: toReference(c)
  }));
}
function alternativesFor(a, c) {
  const out = [];
  const push = (objective, goal, label, customEventType) => {
    if (objective === c.objective && goal === a.optimizationGoal) return;
    if (!findDestination(objective, a.destination)?.goals.some((g) => g.goal === goal)) return;
    if (out.some((x) => x.objective === objective && x.optimizationGoal === goal)) return;
    out.push({ objective, destination: a.destination, optimizationGoal: goal, label, customEventType });
  };
  const purchaseIntent = ["MESSAGING_PURCHASE_CONVERSION", "OFFSITE_CONVERSIONS", "VALUE"].includes(a.optimizationGoal);
  if (purchaseIntent) {
    if (a.pixelId) push("OUTCOME_SALES", "OFFSITE_CONVERSIONS", "Ventas \xB7 Conversiones (compra) con el dataset de WhatsApp", "PURCHASE");
    push("OUTCOME_SALES", "MESSAGING_PURCHASE_CONVERSION", "Ventas \xB7 Compras por mensajes");
    push("OUTCOME_ENGAGEMENT", "MESSAGING_PURCHASE_CONVERSION", "Interacci\xF3n \xB7 Compras por mensajes");
    push("OUTCOME_SALES", "CONVERSATIONS", "Ventas \xB7 Conversaciones (medir compras con el dataset)");
  }
  push(c.objective, "CONVERSATIONS", (OBJECTIVE_BY_KEY[c.objective]?.label || c.objective) + " \xB7 Conversaciones");
  push("OUTCOME_ENGAGEMENT", "CONVERSATIONS", "Interacci\xF3n \xB7 Conversaciones");
  return out.slice(0, 5);
}
async function createCampaign(g, accountId, c, currency) {
  const p = campaignPayload(c, currency);
  const r = await g.post(actId(accountId) + "/campaigns", p);
  return { id: r.id, payload: p };
}
async function createAdset(g, accountId, a, c, campaignId, currency) {
  const p = adsetPayload(a, c, currency, campaignId);
  const r = await g.post(actId(accountId) + "/adsets", p);
  return { id: r.id, payload: p };
}
async function createAd(g, accountId, ad, a, objective, adsetId) {
  const cp = creativePayload(ad, a, objective);
  const cr = await g.post(actId(accountId) + "/adcreatives", cp);
  const p = adPayload(ad, adsetId, cr.id);
  const r = await g.post(actId(accountId) + "/ads", p);
  return { id: r.id, creativeId: cr.id, payload: { creative: cp, ad: p } };
}

// server/routes/ops.ts
init_token();
async function accInfo(id) {
  const g = await graph();
  const list2 = (await adAccounts(g)).value;
  return list2.find((a) => a.id === actId(id)) || account(g, id);
}
var errOut = (e) => e instanceof MetaApiError ? { error: e.info.userMessage || e.info.message, meta: e.info } : { error: String(e?.message || e) };
function validateUpdate(ch, minDaily) {
  for (const [k, { after }] of Object.entries(ch.fields || {})) {
    if (k === "name" && !String(after || "").trim()) return "El nombre no puede quedar vac\xEDo.";
    if ((k === "daily_budget" || k === "lifetime_budget") && !(Number(after) > 0)) return "El presupuesto debe ser mayor a cero.";
    if (k === "daily_budget" && minDaily && Number(after) < minDaily) return `El presupuesto diario es menor al m\xEDnimo de la cuenta (${minDaily}).`;
    if ((k === "end_time" || k === "stop_time") && after && Date.parse(after) < Date.now()) return "La fecha de fin ya pas\xF3.";
    if (k === "status" && !["ACTIVE", "PAUSED", "ARCHIVED"].includes(after)) return "Estado no v\xE1lido.";
    if (k === "creative.link" && after && !/^https?:\/\/[^\s]+\.[^\s]+/.test(after)) return "La URL no es v\xE1lida.";
    if (k === "creative.url_tags" && /\s/.test(String(after || ""))) return "Los par\xE1metros de URL no pueden tener espacios.";
  }
  return null;
}
function budgetIncreasePct(ch) {
  let max = 0;
  for (const k of ["daily_budget", "lifetime_budget"]) {
    const f = ch.fields?.[k];
    if (f && Number(f.before) > 0) max = Math.max(max, (Number(f.after) - Number(f.before)) / Number(f.before) * 100);
  }
  return max;
}
function registerOps(r) {
  r.post("/api/accounts/:id/verify", async (ctx) => {
    const id = await ensureAccountAccess(ctx, ctx.params.id);
    const b = await ctx.json();
    const draft = { ...b.draft, accountId: id };
    const acc = await accInfo(id);
    const g = await graph();
    const res = await verifyDraft(g, draft, acc.currency, { allowTemp: !!b.allowTemp, minDaily: acc.minDailyBudget });
    await audit({
      user: ctx.user.email,
      action: "campaign.verify",
      result: res.items.some((i) => i.status === "error") ? "error" : "ok",
      accountId: id,
      accountName: acc.name,
      level: "campaign",
      entityName: draft.campaign?.name,
      meta: { items: res.items.map((i) => ({ scope: i.scope, name: i.name, status: i.status, message: i.message.slice(0, 300) })), temps: res.tempCampaignsDeleted }
    });
    return res;
  }, { permission: "create" });
  r.post("/api/accounts/:id/create", async (ctx) => {
    const id = await ensureAccountAccess(ctx, ctx.params.id);
    const b = await ctx.json();
    const acc = await accInfo(id);
    const g = await graph();
    const d = b.draft;
    if (acc.status !== 1) throw new ApiError(409, `La cuenta "${acc.name}" no est\xE1 activa (${acc.statusLabel}).`);
    try {
      let out;
      if (b.step === "campaign") {
        if (d.campaign.status === "ACTIVE" && !ctx.user.permissions.includes("publish")) throw new ApiError(403, "Tu rol puede crear en pausa, pero no activar. Pide a un coordinador que lo active.");
        out = await createCampaign(g, id, d.campaign, acc.currency);
        await audit({ user: ctx.user.email, action: "campaign.create", result: "ok", accountId: id, accountName: acc.name, level: "campaign", entityId: out.id, entityName: d.campaign.name, meta: { payload: out.payload } });
      } else if (b.step === "adset") {
        const a = d.adsets.find((x) => x.tmpId === b.tmpId);
        if (!a) throw new ApiError(400, "Conjunto no encontrado en el borrador.");
        out = await createAdset(g, id, a, d.campaign, b.campaignId, acc.currency);
        await audit({ user: ctx.user.email, action: "adset.create", result: "ok", accountId: id, accountName: acc.name, level: "adset", entityId: out.id, entityName: a.name, meta: { payload: out.payload, campaignId: b.campaignId } });
      } else if (b.step === "ad") {
        const ad = d.ads.find((x) => x.tmpId === b.tmpId);
        const a = d.adsets.find((x) => x.tmpId === ad?.adsetTmpId);
        if (!ad || !a) throw new ApiError(400, "Anuncio no encontrado en el borrador.");
        out = await createAd(g, id, ad, a, d.campaign.objective, b.adsetId);
        await audit({ user: ctx.user.email, action: "ad.create", result: "ok", accountId: id, accountName: acc.name, level: "ad", entityId: out.id, entityName: ad.name, meta: { payload: out.payload, adsetId: b.adsetId } });
      } else throw new ApiError(400, "Paso desconocido.");
      await invalidateAccount(id);
      return { ok: true, ...out };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await audit({ user: ctx.user.email, action: b.step + ".create", result: "error", accountId: id, accountName: acc.name, level: b.step, entityName: b.tmpId, error: e.info?.message || e.message, meta: { meta: e.info } });
      return { ok: false, ...errOut(e) };
    }
  }, { permission: "create" });
  r.post("/api/changes/apply", async (ctx) => {
    const b = await ctx.json();
    let changes = b.changes || [];
    if (!changes.length) return { results: [] };
    if (changes.length > 25) throw new ApiError(400, "Env\xEDa los cambios en lotes de hasta 25.");
    const u = ctx.user;
    if (!u.permissions.includes("publish")) throw new ApiError(403, "Tu rol puede preparar cambios pero no publicarlos. Pide a un coordinador o director que los publique.");
    const g = await graph();
    const results = [];
    const touched = /* @__PURE__ */ new Set();
    const simple = [];
    const owners = await ownerAccounts(g, changes.map((c) => c.entityId)).catch(() => ({}));
    const foreign = changes.filter((c) => owners[String(c.entityId)] && owners[String(c.entityId)] !== actId(c.accountId));
    for (const ch of foreign) {
      results.push({ id: ch.id, ok: false, error: `El objeto ${ch.entityId} pertenece a la cuenta ${owners[String(ch.entityId)]}, no a ${actId(ch.accountId)}. Recarga la cuenta y vuelve a preparar el cambio.` });
      await audit({ user: u.email, action: ch.level + "." + ch.kind, result: "error", accountId: actId(ch.accountId), level: ch.level, entityId: ch.entityId, entityName: ch.entityName, error: "Cuenta del objeto distinta a la indicada" });
    }
    const blocked = new Set(foreign.map((c) => c.id));
    changes = changes.filter((c) => !blocked.has(c.id));
    for (const ch of changes.filter((c) => c.kind === "update" && !Object.keys(c.fields || {}).some((k) => k.startsWith("creative.")))) {
      const id = await ensureAccountAccess(ctx, ch.accountId);
      const acc = await accInfo(id);
      const v2 = validateUpdate(ch, acc.minDailyBudget);
      const inc = budgetIncreasePct(ch);
      if (v2 || inc > 50 && !u.permissions.includes("publish_budget_increase")) continue;
      try {
        simple.push({ ch, id, acc, payload: updatePayload(ch.level, ch.fields || {}, acc.currency) });
      } catch {
      }
    }
    if (simple.length > 1) {
      const res = await g.batch(simple.map((x) => ({ method: "POST", relative_url: x.ch.entityId, body: x.payload })));
      for (let i = 0; i < simple.length; i++) {
        const { ch, id, acc, payload } = simple[i];
        touched.add(id);
        const base = { user: u.email, accountId: id, accountName: acc.name, level: ch.level, entityId: ch.entityId, entityName: ch.entityName };
        if (res[i].ok) {
          await audit({ ...base, action: ch.level + ".update", result: "ok", changes: ch.fields, meta: { payload, via: "batch" } });
          results.push({ id: ch.id, ok: true });
        } else {
          const info = res[i].error.info;
          await audit({ ...base, action: ch.level + ".update", result: "error", changes: ch.fields, error: info.message, meta: { meta: info } });
          results.push({ id: ch.id, ok: false, error: info.userMessage || info.message, meta: info });
        }
      }
    }
    const done = new Set(simple.length > 1 ? simple.map((x) => x.ch.id) : []);
    for (const ch of changes.filter((c) => !done.has(c.id))) {
      const id = await ensureAccountAccess(ctx, ch.accountId);
      touched.add(id);
      const acc = await accInfo(id);
      const base = { user: u.email, accountId: id, accountName: acc.name, level: ch.level, entityId: ch.entityId, entityName: ch.entityName };
      try {
        if (ch.kind === "update") {
          const v2 = validateUpdate(ch, acc.minDailyBudget);
          if (v2) throw new ApiError(400, v2);
          const inc = budgetIncreasePct(ch);
          if (inc > 50 && !u.permissions.includes("publish_budget_increase")) throw new ApiError(403, `Subir el presupuesto ${inc.toFixed(0)} % requiere aprobaci\xF3n de un director.`);
          const res = await updateEntity(g, ch.level, ch.entityId, id, acc.currency, ch.fields || {});
          await audit({ ...base, action: ch.level + ".update", result: "ok", changes: ch.fields, meta: { payload: res.payload } });
          results.push({ id: ch.id, ok: true });
        } else if (ch.kind === "delete") {
          if (!u.permissions.includes("delete")) throw new ApiError(403, "Tu rol no puede eliminar.");
          await deleteEntity(g, ch.entityId);
          await audit({ ...base, action: ch.level + ".delete", result: "ok" });
          results.push({ id: ch.id, ok: true });
        } else if (ch.kind === "duplicate") {
          const o = ch.duplicate;
          if (actId(o.targetAccountId) !== id) throw new ApiError(400, "La duplicaci\xF3n a otra cuenta se hace con el asistente de duplicaci\xF3n.");
          const ids = [];
          for (let i = 0; i < Math.min(o.count || 1, 10); i++) {
            const res = await copyEntity(g, ch.level, ch.entityId, { deep: o.deep, statusOption: o.statusOption, renameSuffix: (o.renameSuffix ?? " - Copia") + ((o.count || 1) > 1 ? " " + (i + 1) : ""), targetParentId: o.targetParentId });
            ids.push(res.id);
          }
          await audit({ ...base, action: ch.level + ".duplicate", result: "ok", meta: { newIds: ids, options: o } });
          results.push({ id: ch.id, ok: true, newIds: ids });
        } else throw new ApiError(400, "Las creaciones se publican desde el creador de campa\xF1as.");
      } catch (e) {
        const out = e instanceof ApiError ? { error: e.message } : errOut(e);
        await audit({ ...base, action: ch.level + "." + ch.kind, result: "error", changes: ch.fields, error: out.error, meta: { meta: out.meta } });
        results.push({ id: ch.id, ok: false, ...out });
      }
    }
    await Promise.all([...touched].map(invalidateAccount));
    return { results };
  }, { permission: "edit" });
  r.post("/api/duplicate/analyze", async (ctx) => {
    const b = await ctx.json();
    await ensureAccountAccess(ctx, b.targetAccountId);
    await ensureAccountAccess(ctx, b.sourceAccountId);
    const g = await graph();
    const own = await ownerAccounts(g, b.ids || []);
    const bad = (b.ids || []).filter((x) => own[String(x)] && own[String(x)] !== actId(b.sourceAccountId));
    if (bad.length) throw new ApiError(403, `Los objetos ${bad.join(", ")} no pertenecen a la cuenta de origen.`, "account_forbidden");
    const [src, dst] = await Promise.all([accInfo(b.sourceAccountId), accInfo(b.targetAccountId)]);
    const res = await analyzeDuplicate(g, b.level, b.ids, b.targetAccountId);
    return { ...res, source: src, target: dst, currencyMismatch: src.currency !== dst.currency, targetActive: dst.status === 1 };
  }, { permission: "create" });
  r.post("/api/duplicate/execute", async (ctx) => {
    const b = await ctx.json();
    const target = await ensureAccountAccess(ctx, b.targetAccountId);
    const source = await ensureAccountAccess(ctx, b.sourceAccountId);
    const g = await graph();
    if (b.sourceId) {
      const own = await ownerAccounts(g, [b.sourceId]);
      if (own[String(b.sourceId)] && own[String(b.sourceId)] !== source) throw new ApiError(403, "El objeto de origen no pertenece a la cuenta de origen.", "account_forbidden");
    }
    const [src, dst] = await Promise.all([accInfo(source), accInfo(target)]);
    const suffix = b.suffix ?? " - Copia";
    const status = b.statusOption || "PAUSED";
    const map = b.map || {};
    const base = { user: ctx.user.email, accountId: target, accountName: dst.name };
    try {
      if (b.step === "media") {
        const res = await migrateMedia(g, source, target, b.refs || []);
        return { ok: true, ...res };
      }
      if (b.step === "campaign") {
        const c = await g.get(b.sourceId, { fields: "name,objective,buying_type,special_ad_categories,special_ad_category_country,daily_budget,lifetime_budget,bid_strategy,is_adset_budget_sharing_enabled,stop_time,status" });
        const p = {
          name: c.name + suffix,
          objective: c.objective,
          buying_type: c.buying_type || "AUCTION",
          special_ad_categories: c.special_ad_categories || [],
          status: status === "INHERITED_FROM_SOURCE" ? c.status : status
        };
        if (c.special_ad_category_country?.length) p.special_ad_category_country = c.special_ad_category_country;
        const hasBudget = Number(c.daily_budget) || Number(c.lifetime_budget);
        if (hasBudget) {
          if (src.currency !== dst.currency && !b.budgetOverride) throw new ApiError(400, `Las cuentas usan monedas distintas (${src.currency} \u2192 ${dst.currency}): indica el presupuesto en ${dst.currency}.`);
          const { toMinor: toMinor2, toMajor: toMajor2 } = await Promise.resolve().then(() => (init_currency(), currency_exports));
          const major = b.budgetOverride ?? toMajor2(c.daily_budget || c.lifetime_budget, src.currency);
          p[Number(c.daily_budget) ? "daily_budget" : "lifetime_budget"] = toMinor2(major, dst.currency);
          p.bid_strategy = c.bid_strategy || "LOWEST_COST_WITHOUT_CAP";
        } else p.is_adset_budget_sharing_enabled = !!c.is_adset_budget_sharing_enabled;
        if (c.stop_time && Date.parse(c.stop_time) > Date.now()) p.stop_time = c.stop_time;
        const res = await g.post(target + "/campaigns", p);
        await audit({ ...base, action: "campaign.duplicate_cross", result: "ok", level: "campaign", entityId: res.id, entityName: p.name, meta: { sourceId: b.sourceId, sourceAccount: source } });
        return { ok: true, id: res.id };
      }
      if (b.step === "adset") {
        const { ADSET_FIELDS: ADSET_FIELDS2 } = await Promise.resolve().then(() => (init_entities(), entities_exports));
        const a = await g.get(b.sourceId, { fields: ADSET_FIELDS2 });
        const p = remapAdset(a, map, b.targetCampaignId, status, suffix);
        if (src.currency !== dst.currency) {
          const { toMinor: toMinor2, toMajor: toMajor2 } = await Promise.resolve().then(() => (init_currency(), currency_exports));
          for (const k of ["daily_budget", "lifetime_budget", "bid_amount"]) if (p[k]) p[k] = b.budgetOverride && k !== "bid_amount" ? toMinor2(b.budgetOverride, dst.currency) : toMinor2(toMajor2(p[k], src.currency), dst.currency);
        }
        const res = await g.post(target + "/adsets", p);
        await audit({ ...base, action: "adset.duplicate_cross", result: "ok", level: "adset", entityId: res.id, entityName: p.name, meta: { sourceId: b.sourceId, map } });
        return { ok: true, id: res.id };
      }
      if (b.step === "ad") {
        const ad = await g.get(b.sourceId, { fields: `name,status,creative{${CREATIVE_FIELDS}}` });
        const cp = remapCreative(ad.creative || {}, map, (ad.creative?.name || ad.name) + suffix);
        const cr = await g.post(target + "/adcreatives", cp);
        const res = await g.post(target + "/ads", { name: ad.name + suffix, adset_id: b.targetAdsetId, creative: { creative_id: cr.id }, status: status === "INHERITED_FROM_SOURCE" ? ad.status : status });
        await audit({ ...base, action: "ad.duplicate_cross", result: "ok", level: "ad", entityId: res.id, entityName: ad.name + suffix, meta: { sourceId: b.sourceId } });
        return { ok: true, id: res.id };
      }
      throw new ApiError(400, "Paso desconocido.");
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await audit({ ...base, action: b.step + ".duplicate_cross", result: "error", level: b.step, entityId: b.sourceId, error: e.info?.message || e.message });
      return { ok: false, ...errOut(e) };
    } finally {
      await invalidateAccount(target);
    }
  }, { permission: "create" });
  r.get("/api/editor/draft/:id", async (ctx) => {
    const id = await ensureAccountAccess(ctx, ctx.params.id);
    return await kv("editor").get(`draft/${ctx.user.email}/${id}`) || { changes: [] };
  });
  r.put("/api/editor/draft/:id", async (ctx) => {
    const id = await ensureAccountAccess(ctx, ctx.params.id);
    const b = await ctx.json();
    await kv("editor").set(`draft/${ctx.user.email}/${id}`, { changes: (b.changes || []).slice(0, 2e3), savedAt: (/* @__PURE__ */ new Date()).toISOString() });
    return { ok: true };
  }, { permission: "edit" });
}

// shared/rules.ts
var LABEL = {
  spend: "gasto",
  cpl: "CPL",
  cpa: "CPA",
  ctr: "CTR",
  cpm: "CPM",
  cpc: "CPC",
  frequency: "frecuencia",
  roas: "ROAS",
  costPerConversation: "costo por conversaci\xF3n",
  costPerResult: "costo por resultado",
  leads: "leads",
  purchases: "compras",
  conversations: "conversaciones",
  impressions: "impresiones",
  results: "resultados",
  budgetSpentPct: "% de presupuesto consumido",
  daysRemaining: "d\xEDas restantes"
};
function cmp(a, op, b) {
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
  }
}
function metricValue(s, m, row, now) {
  if (m === "budgetSpentPct") {
    if (s.lifetimeBudget) return (s.lifetimeSpent || 0) / s.lifetimeBudget * 100;
    return null;
  }
  if (m === "daysRemaining") {
    if (!s.endTime) return null;
    return Math.max(0, (Date.parse(s.endTime) - now.getTime()) / 864e5);
  }
  if (!row) return null;
  return Number(row[m]) || 0;
}
function evaluateCondition(s, c, now = /* @__PURE__ */ new Date()) {
  const label = LABEL[c.metric] || c.metric;
  if (c.kind === "change_pct") {
    const cur = metricValue(s, c.metric, s.windows[c.windowDays], now);
    const prev = metricValue(s, c.metric, s.previous[c.windowDays], now);
    if (cur === null || prev === null) return { ok: false, evidence: `${label}: sin datos` };
    const ch = pctChange(cur, prev);
    if (ch === null) return { ok: false, evidence: `${label}: sin periodo de comparaci\xF3n` };
    return { ok: cmp(ch, c.op, c.value), evidence: `${label} ${ch >= 0 ? "+" : ""}${ch.toFixed(1)} % (${fmt(prev)} \u2192 ${fmt(cur)}, ${c.windowDays} d vs anteriores)` };
  }
  if (c.everyDay && !["budgetSpentPct", "daysRemaining"].includes(c.metric)) {
    const days = s.daily.slice(-c.windowDays);
    if (days.length < c.windowDays) return { ok: false, evidence: `${label}: menos de ${c.windowDays} d\xEDas de datos` };
    const vals = days.map((d) => metricValue(s, c.metric, d, now));
    return { ok: vals.every((v3) => cmp(v3, c.op, c.value)), evidence: `${label} por d\xEDa: ${vals.map(fmt).join(" \xB7 ")}` };
  }
  const v2 = metricValue(s, c.metric, s.windows[c.windowDays], now);
  if (v2 === null) return { ok: false, evidence: `${label}: sin datos` };
  return { ok: cmp(v2, c.op, c.value), evidence: `${label} = ${fmt(v2)} (${c.windowDays} d)` };
}
function fmt(v2) {
  return Math.abs(v2) >= 100 ? v2.toFixed(0) : v2.toFixed(2);
}
function evaluateRule(rule, subjects, now = /* @__PURE__ */ new Date()) {
  if (!rule.enabled) return [];
  const out = [];
  for (const s of subjects) {
    if (s.level !== rule.level) continue;
    if (rule.accountIds.length && !rule.accountIds.includes(s.accountId)) continue;
    if (rule.nameContains && !s.name.toLowerCase().includes(rule.nameContains.toLowerCase())) continue;
    if (s.status !== "ACTIVE") continue;
    const maxWin = Math.max(...rule.conditions.map((c) => c.windowDays), 1);
    if (rule.minSpend && (s.windows[maxWin]?.spend || 0) < rule.minSpend) continue;
    const res = rule.conditions.map((c) => evaluateCondition(s, c, now));
    const ok2 = rule.logic === "all" ? res.every((r) => r.ok) : res.some((r) => r.ok);
    if (ok2) out.push({
      ruleId: rule.id,
      ruleName: rule.name,
      subjectId: s.id,
      subjectName: s.name,
      level: s.level,
      accountId: s.accountId,
      action: rule.action,
      mode: rule.mode,
      evidence: res.map((r) => r.evidence),
      at: now.toISOString()
    });
  }
  return out;
}

// server/routes/admin.ts
init_env();
init_crypto();
init_store();
init_assets();
init_entities();
init_token();
async function listRules() {
  const keys = await kv("core").list("rule/");
  return (await Promise.all(keys.map((k) => kv("core").get(k)))).filter(Boolean);
}
async function runRules(accountIds, actor, opts) {
  const g = await graph();
  const rules = (await listRules()).filter((r) => r.enabled);
  const accs = (await adAccounts(g)).value.filter((a) => a.status === 1 && (!accountIds || accountIds.includes(a.id))).filter((a) => rules.some((r) => !r.accountIds.length || r.accountIds.includes(a.id))).slice(0, 25);
  const matches = [];
  const executed = [];
  for (const acc of accs) {
    let subjects;
    try {
      subjects = (await buildSubjects(g, acc)).rules;
    } catch (e) {
      matches.push({ ruleId: "-", ruleName: "Error al leer la cuenta", subjectId: acc.id, subjectName: acc.name, level: "campaign", accountId: acc.id, action: { type: "alert" }, mode: "recommend", evidence: [e.info?.message || e.message], at: (/* @__PURE__ */ new Date()).toISOString() });
      continue;
    }
    for (const rule of rules) {
      for (const m of evaluateRule(rule, subjects)) {
        const cdKey = `rulecd/${rule.id}/${m.subjectId}`;
        const last = await kv("core").get(cdKey);
        if (last && Date.now() - last.at < rule.cooldownHours * 36e5) continue;
        matches.push(m);
        await kv("core").set(cdKey, { at: Date.now() });
        if (opts.execute && rule.mode === "auto" && executed.length < 20 && ["pause", "increase_budget", "decrease_budget"].includes(rule.action.type)) {
          try {
            const s = subjects.find((x) => x.id === m.subjectId);
            const fields = {};
            if (rule.action.type === "pause") fields.status = { before: s.status, after: "PAUSED" };
            else if (s.dailyBudget) {
              const f = rule.action.type === "increase_budget" ? 1 + (rule.action.pct || 10) / 100 : 1 - (rule.action.pct || 10) / 100;
              let nb = Math.round(s.dailyBudget * f);
              if (rule.action.maxBudget) nb = Math.min(nb, rule.action.maxBudget);
              fields.daily_budget = { before: s.dailyBudget, after: nb };
            }
            if (Object.keys(fields).length) {
              await updateEntity(g, m.level, m.subjectId, acc.id, acc.currency, fields);
              await audit({ user: "regla:" + rule.name, action: m.level + ".update", result: "ok", accountId: acc.id, accountName: acc.name, level: m.level, entityId: m.subjectId, entityName: m.subjectName, changes: fields, meta: { rule: rule.id, evidence: m.evidence, triggeredBy: actor } });
              executed.push({ ...m, fields });
            }
          } catch (e) {
            await audit({ user: "regla:" + rule.name, action: m.level + ".update", result: "error", accountId: acc.id, entityId: m.subjectId, error: e.info?.message || e.message });
          }
        }
      }
    }
  }
  const at = (/* @__PURE__ */ new Date()).toISOString();
  for (const m of matches) await kv("core").set(`alert/${at.slice(0, 10)}/${m.ruleId}-${m.subjectId}-${randomId(3)}`, { ...m, status: "open" });
  return { matches, executed, at, accounts: accs.length };
}
function registerAdmin(r) {
  r.get("/api/recommendations", async (ctx) => {
    const g = await graph();
    const accountId = ctx.url.searchParams.get("accountId");
    const allowed = await allowedAccounts(ctx);
    let accs = (await adAccounts(g)).value.filter((a) => a.status === 1 && (!allowed || allowed.includes(a.id)));
    if (accountId) accs = accs.filter((a) => a.id === accountId);
    const out = [], errors = [];
    for (const acc of accs.slice(0, accountId ? 1 : 10)) {
      try {
        out.push(...analyze((await buildSubjects(g, acc)).analysis));
      } catch (e) {
        errors.push(`${acc.name}: ${e.info?.message || e.message}`);
      }
    }
    return { recommendations: out, errors, analyzedAt: (/* @__PURE__ */ new Date()).toISOString() };
  });
  r.get("/api/rules", async () => ({ rules: await listRules() }));
  r.post("/api/rules", async (ctx) => {
    const b = await ctx.json();
    const u = ctx.user;
    const rule = { ...b, id: b.id || randomId(8), updatedAt: (/* @__PURE__ */ new Date()).toISOString(), createdBy: b.createdBy || u.email };
    if (!rule.name || !rule.conditions?.length) throw new ApiError(400, "La regla necesita nombre y al menos una condici\xF3n.");
    if (rule.mode === "auto" && !u.permissions.includes("rules_execute")) throw new ApiError(403, "Solo un director o administrador puede activar la ejecuci\xF3n autom\xE1tica.");
    const before = await kv("core").get("rule/" + rule.id);
    await kv("core").set("rule/" + rule.id, rule);
    await audit({ user: u.email, action: before ? "rule.update" : "rule.create", result: "ok", level: "rule", entityId: rule.id, entityName: rule.name, changes: before ? { regla: { before, after: rule } } : void 0 });
    return rule;
  }, { permission: "rules" });
  r.del("/api/rules/:id", async (ctx) => {
    await kv("core").del("rule/" + ctx.params.id);
    await audit({ user: ctx.user.email, action: "rule.delete", result: "ok", level: "rule", entityId: ctx.params.id });
    return { ok: true };
  }, { permission: "rules" });
  r.post("/api/rules/run", async (ctx) => {
    const b = await ctx.json().catch(() => ({}));
    const allowed = await allowedAccounts(ctx);
    if (b.accountId) b.accountId = await ensureAccountAccess(ctx, b.accountId);
    const res = await runRules(b.accountId ? [b.accountId] : allowed, ctx.user.email, { execute: !!b.execute && ctx.user.permissions.includes("rules_execute") });
    await kv("core").set("sync/rules", { at: res.at, by: ctx.user.email });
    return res;
  }, { permission: "rules" });
  r.get("/api/alerts", async (ctx) => {
    const days = Number(ctx.url.searchParams.get("days") || 7);
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const keys = (await kv("core").list("alert/")).filter((k) => k.split("/")[1] >= since).reverse().slice(0, 500);
    const allowed = await allowedAccounts(ctx);
    const alerts = (await Promise.all(keys.map(async (k) => ({ key: k, ...await kv("core").get(k) })))).filter((a) => a.status !== "dismissed" && (!allowed || allowed.includes(a.accountId)));
    return { alerts };
  });
  r.post("/api/alerts/dismiss", async (ctx) => {
    const b = await ctx.json();
    for (const k of (b.keys || []).slice(0, 200)) {
      if (typeof k !== "string" || !/^alert\/\d{4}-\d{2}-\d{2}\//.test(k)) continue;
      const a = await kv("core").get(k);
      if (a) await kv("core").set(k, { ...a, status: "dismissed", dismissedBy: ctx.user.email });
    }
    return { ok: true };
  });
  r.get("/api/utm-templates", async () => {
    const keys = await kv("core").list("utm/");
    return { templates: (await Promise.all(keys.map((k) => kv("core").get(k)))).filter(Boolean) };
  });
  r.post("/api/utm-templates", async (ctx) => {
    const b = await ctx.json();
    if (b.scope === "empresa" && !ctx.user.permissions.includes("templates")) throw new ApiError(403, "Tu rol no puede guardar plantillas de empresa.");
    if (b.scope === "cuenta" && b.scopeId) await ensureAccountAccess(ctx, b.scopeId);
    const t = { ...b, id: b.id || randomId(8), createdBy: b.createdBy || ctx.user.email, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await kv("core").set("utm/" + t.id, t);
    await audit({ user: ctx.user.email, action: "template.save", result: "ok", level: "template", entityId: t.id, entityName: t.name, meta: { scope: t.scope, params: t.params } });
    return t;
  }, { permission: "edit" });
  r.del("/api/utm-templates/:id", async (ctx) => {
    await kv("core").del("utm/" + ctx.params.id);
    await audit({ user: ctx.user.email, action: "template.delete", result: "ok", level: "template", entityId: ctx.params.id });
    return { ok: true };
  }, { permission: "templates" });
  r.get("/api/audit", async (ctx) => {
    const s = ctx.url.searchParams;
    const u = ctx.user;
    const user = u.permissions.includes("audit") ? s.get("user") || void 0 : u.email;
    return { entries: await queryAudit({ from: s.get("from") || void 0, to: s.get("to") || void 0, user, accountId: s.get("accountId") || void 0, action: s.get("action") || void 0, q: s.get("q") || void 0, limit: Number(s.get("limit") || 300), kind: s.get("kind") === "access" ? "access" : "log" }) };
  });
  r.get("/api/users", async () => ({ users: (await listUsers()).sort((a, b) => (b.lastLoginAt || "").localeCompare(a.lastLoginAt || "")) }), { permission: "users" });
  r.put("/api/users/:email", async (ctx) => {
    const b = await ctx.json();
    const u = await getUser(ctx.params.email);
    if (!u) throw new ApiError(404, "Usuario no encontrado.");
    if (u.email === ctx.user.email && b.role && b.role !== "admin") throw new ApiError(400, "No puedes quitarte el rol de administrador a ti mismo.");
    const before = { role: u.role, active: u.active, accountIds: u.accountIds || [] };
    if (b.role && ROLE_ORDER.includes(b.role)) u.role = b.role;
    if (typeof b.active === "boolean") u.active = b.active;
    if (Array.isArray(b.accountIds)) u.accountIds = b.accountIds;
    u.updatedBy = ctx.user.email;
    await saveUser(u);
    if (before.role !== u.role || !u.active) await revokeUserSessions(u.email);
    await audit({ user: ctx.user.email, action: "user.update", result: "ok", level: "user", entityId: u.email, entityName: u.name, changes: { usuario: { before, after: { role: u.role, active: u.active, accountIds: u.accountIds || [] } } } });
    return u;
  }, { permission: "users" });
  r.post("/api/motor", async (ctx) => {
    if (!env.motorUrl || !env.motorSecret) throw new ApiError(503, "El motor de plan masivo no est\xE1 configurado (MOTOR_URL y MOTOR_SHARED_SECRET).", "motor_config");
    const u = ctx.user;
    const body = await ctx.json();
    const accion = String(body.accion || "");
    const escritura = ["publicar", "subir", "gestor", "formularios", "lote_accion"].includes(accion) || accion === "buscar" && ["lote_accion"].includes(body.tipo);
    if (escritura && !u.permissions.includes("plan")) throw new ApiError(403, "Tu rol no puede publicar planes masivos.");
    if (accion === "gestor" && body.op === "aplicar" && !u.permissions.includes("publish")) throw new ApiError(403, "Tu rol no puede aplicar cambios.");
    delete body.clave;
    const allowedM = await allowedAccounts(ctx);
    if (allowedM) {
      const pedidas = [body.cuenta_id, ...String(body.cuentas || "").split(",")].map((x) => String(x || "").trim()).filter(Boolean);
      for (const c of pedidas) await ensureAccountAccess(ctx, c);
    }
    const res = await fetch(env.motorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ABCW-Clave": env.motorSecret, "X-ABCW-Usuario": u.email },
      body: JSON.stringify({ ...body, usuario: u.email }),
      signal: AbortSignal.timeout(25e3)
    }).catch((e) => {
      throw new ApiError(504, "El motor (n8n) no respondi\xF3: " + e.message, "motor_timeout");
    });
    let text = await res.text();
    if (allowedM && accion === "cuentas" && res.ok) {
      const d = safeJson(text);
      if (d && Array.isArray(d.cuentas)) {
        d.cuentas = d.cuentas.filter((c) => allowedM.includes(actId(c.cuenta || c.id || c.account_id || "")));
        text = JSON.stringify(d);
      }
    }
    if (escritura || accion === "publicar") await audit({ user: u.email, action: "plan." + accion + (body.op ? "." + body.op : ""), result: res.ok ? "ok" : "error", level: "plan", accountId: body.cuenta_id ? "act_" + String(body.cuenta_id).replace(/^act_/, "") : void 0, meta: { status: res.status, run: safeJson(text)?.run_id } });
    return new Response(text, { status: res.status, headers: { "Content-Type": res.headers.get("content-type") || "application/json", "Cache-Control": "no-store" } });
  });
  void json;
}
function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// server/routes/collab.ts
init_env();
init_crypto();
init_store();
init_entities();
function registerCollab(r) {
  r.post("/api/approvals", async (ctx) => {
    const b = await ctx.json();
    const id = await ensureAccountAccess(ctx, b.accountId);
    if (!Array.isArray(b.changes) || !b.changes.length) throw new ApiError(400, "No hay cambios para aprobar.");
    const a = {
      id: randomId(8),
      accountId: id,
      accountName: b.accountName,
      changes: b.changes.slice(0, 2e3),
      note: String(b.note || "").slice(0, 1e3),
      status: "pending",
      requestedBy: ctx.user.email,
      requestedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await kv("editor").set("approval/" + a.id, a);
    await audit({ user: ctx.user.email, action: "approval.request", result: "ok", accountId: id, accountName: b.accountName, level: "plan", entityId: a.id, meta: { changes: a.changes.length, note: a.note } });
    return a;
  }, { permission: "edit" });
  r.get("/api/approvals", async (ctx) => {
    const acc = ctx.url.searchParams.get("accountId");
    const keys = await kv("editor").list("approval/");
    const all2 = (await Promise.all(keys.map((k) => kv("editor").get(k)))).filter(Boolean);
    const mine = !ctx.user.permissions.includes("publish");
    const allowed = await allowedAccounts(ctx);
    return { approvals: all2.filter((a) => (!acc || a.accountId === acc) && (!allowed || allowed.includes(a.accountId)) && (!mine || a.requestedBy === ctx.user.email)).sort((x, y) => y.requestedAt.localeCompare(x.requestedAt)).slice(0, 100) };
  });
  r.post("/api/approvals/:id/decision", async (ctx) => {
    const a = await kv("editor").get("approval/" + ctx.params.id);
    if (!a) throw new ApiError(404, "Solicitud no encontrada.");
    await ensureAccountAccess(ctx, a.accountId);
    const b = await ctx.json();
    if (!["approved", "rejected", "published"].includes(b.decision)) throw new ApiError(400, "Decisi\xF3n no v\xE1lida.");
    if (a.requestedBy === ctx.user.email && b.decision !== "published") throw new ApiError(403, "No puedes aprobar tu propia solicitud.");
    a.status = b.decision;
    a.decidedBy = ctx.user.email;
    a.decidedAt = (/* @__PURE__ */ new Date()).toISOString();
    a.comment = String(b.comment || "").slice(0, 1e3);
    await kv("editor").set("approval/" + a.id, a);
    await audit({ user: ctx.user.email, action: "approval." + b.decision, result: "ok", accountId: a.accountId, accountName: a.accountName, level: "plan", entityId: a.id, meta: { requestedBy: a.requestedBy, comment: a.comment } });
    return a;
  }, { permission: "publish" });
  r.get("/api/webhooks/meta", (ctx) => {
    const p = ctx.url.searchParams;
    const token = process.env.META_WEBHOOK_VERIFY_TOKEN || "";
    if (p.get("hub.mode") === "subscribe" && token && p.get("hub.verify_token") === token) return new Response(p.get("hub.challenge") || "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }, { auth: false });
  r.post("/api/webhooks/meta", async (ctx) => {
    const raw = await ctx.req.text();
    const sig2 = ctx.req.headers.get("x-hub-signature-256") || "";
    if (!env.metaAppSecret) return json({ error: "META_APP_SECRET no configurado" }, 503);
    const expected = "sha256=" + await hmacHex(env.metaAppSecret, raw);
    if (sig2.length !== expected.length || !timingSafe(sig2, expected)) return json({ error: "firma inv\xE1lida" }, 401);
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "JSON inv\xE1lido" }, 400);
    }
    const at = (/* @__PURE__ */ new Date()).toISOString();
    for (const e of body.entry || []) {
      const acc = "act_" + String(e.id || "").replace(/^act_/, "");
      await invalidateAccount(acc);
      for (const ch of e.changes || []) {
        const v2 = ch.value || {};
        const issue = /with_issues|disapproved|issues/i.test(ch.field || "") || v2.status === "WITH_ISSUES" || v2.status === "DISAPPROVED";
        if (issue) await kv("core").set(`alert/${at.slice(0, 10)}/webhook-${randomId(5)}`, { ruleId: "webhook", ruleName: "Meta: " + ch.field, subjectId: String(v2.id || ""), subjectName: String(v2.name || v2.id || ""), level: v2.level || "ad", accountId: acc, action: { type: "alert" }, mode: "recommend", evidence: [JSON.stringify(v2).slice(0, 300)], at, status: "open" });
      }
    }
    await kv("core").set("sync/webhook", { at, entries: (body.entry || []).length });
    return json({ ok: true });
  }, { auth: false, csrf: false });
}
function timingSafe(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// server/api.ts
var router = new Router();
registerAuth(router);
registerMeta(router);
registerData(router);
registerOps(router);
registerAdmin(router);
registerCollab(router);
var transportReady = false;
function ensureTransport() {
  if (transportReady) return;
  transportReady = true;
  if (env.metaMode === "mock") {
    if (!env.isLocal && env.isProduction) throw new Error("META_MODE=mock no se permite en producci\xF3n.");
    setTransport(mockTransport);
  }
}
function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const app = new URL(env.appUrl);
    const self = new URL(req.url);
    return o.host === app.host || o.host === self.host || env.isLocal && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(o.host);
  } catch {
    return false;
  }
}
async function handle(req) {
  ensureTransport();
  const url = new URL(req.url);
  const path2 = url.pathname.replace(/^\/\.netlify\/functions\/api/, "/api");
  const m = router.match(req.method, path2);
  if (!m) return json({ error: "Ruta no encontrada: " + req.method + " " + path2 }, 404);
  const ctx = {
    req,
    url,
    params: m.params,
    ip: clientIp(req),
    setCookies: [],
    json: async () => {
      try {
        return await req.json();
      } catch {
        throw new ApiError(400, "El cuerpo de la solicitud no es JSON v\xE1lido.");
      }
    }
  };
  const started = Date.now();
  try {
    if (req.method !== "GET" && m.route.opts.csrf !== false) {
      if (req.headers.get("x-pmos") !== "1" || !sameOrigin(req)) throw new ApiError(403, "Solicitud rechazada (origen no permitido).", "csrf");
    }
    if (m.route.opts.auth) {
      const s = await readSession(req);
      if (!s) throw new ApiError(401, "Tu sesi\xF3n venci\xF3 o no has iniciado sesi\xF3n.", "unauthenticated");
      ctx.user = s.user;
      ctx.sessionId = s.record.id;
      if (s.refreshCookie) ctx.setCookies.push(s.refreshCookie);
      if (m.route.opts.permission && !s.user.permissions.includes(m.route.opts.permission))
        throw new ApiError(403, "Tu rol (" + s.user.role + ") no tiene permiso para esta acci\xF3n.", "forbidden");
    }
    const out = await m.route.handler(ctx);
    const res = out instanceof Response ? out : json(out);
    ctx.setCookies.forEach((c) => res.headers.append("Set-Cookie", c));
    return res;
  } catch (e) {
    const ms = Date.now() - started;
    let res;
    if (e instanceof ApiError) res = json({ error: e.message, code: e.code, details: e.details }, e.status);
    else if (e instanceof MetaApiError) {
      res = json({ error: e.info.userMessage || e.info.message, code: "meta_error", meta: e.info }, 424);
    } else {
      console.error("[api] error", req.method, path2, e);
      res = json({ error: "Error interno: " + String(e?.message || e), code: "internal" }, 500);
    }
    console.warn("[api]", req.method, path2, res.status, ms + "ms");
    ctx.setCookies.forEach((c) => res.headers.append("Set-Cookie", c));
    return res;
  }
}

// netlify/functions/api.mts
var api_default = async (req) => handle(req);
var config = { path: "/api/*" };
export {
  config,
  api_default as default
};
