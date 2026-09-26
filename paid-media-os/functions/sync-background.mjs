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
async function decrypt(blob) {
  const [iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(iv) }, await keyFor("tokens", "aes"), fromB64u(ct));
  return new TextDecoder().decode(pt);
}
function randomId(bytes = 16) {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
        delete: (key) => delete process2?.env[key],
        get: (key) => process2?.env[key],
        has: (key) => Boolean(process2?.env[key]),
        set: (key, value) => {
          if (process2?.env) {
            process2.env[key] = value;
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
      let message = `Netlify Blobs has generated an internal error (${details})`;
      if (!res.headers.get(NF_ERROR) && responseBody) {
        message += `: ${responseBody}`;
      }
      return message;
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
        key,
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
        if (key) {
          urlPath += `/${key}`;
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
          for (const key2 in parameters) {
            url2.searchParams.set(key2, parameters[key2]);
          }
          return {
            headers,
            url: url2.toString()
          };
        }
        const apiHeaders = { authorization: `Bearer ${this.token}` };
        const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
        for (const key2 in parameters) {
          url.searchParams.set(key2, parameters[key2]);
        }
        if (this.region) {
          url.searchParams.set("region", this.region);
        }
        if (storeName === void 0 || key === void 0) {
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
        key,
        metadata,
        method,
        parameters,
        storeName
      }) {
        const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
          consistency,
          key,
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
        const usesSignedUrl = !this.edgeURL && key !== void 0 && storeName !== void 0 && method !== "head" && method !== "delete";
        let getRetryUrl;
        if (usesSignedUrl) {
          getRetryUrl = async () => {
            const finalRequest = await this.getFinalRequest({ consistency, key, metadata, method, parameters, storeName });
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
      async delete(key) {
        const res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
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
      async get(key, options) {
        return withSpan(options?.span, "blobs.get", async (span) => {
          const { consistency, type } = options ?? {};
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key,
            "blobs.type": type,
            "blobs.method": "GET",
            "blobs.consistency": consistency
          });
          const res = await this.client.makeRequest({
            consistency,
            key,
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
      async getMetadata(key, options = {}) {
        return withSpan(options?.span, "blobs.getMetadata", async (span) => {
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key,
            "blobs.method": "HEAD",
            "blobs.consistency": options.consistency
          });
          const res = await this.client.makeRequest({
            consistency: options.consistency,
            key,
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
      async getWithMetadata(key, options) {
        return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
          const { consistency, etag: requestETag, type } = options ?? {};
          const headers = requestETag ? { "if-none-match": requestETag } : void 0;
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key,
            "blobs.method": "GET",
            "blobs.consistency": options?.consistency,
            "blobs.type": type,
            "blobs.request.etag": requestETag
          });
          const res = await this.client.makeRequest({
            consistency,
            headers,
            key,
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
      async set(key, data, options = {}) {
        return withSpan(options.span, "blobs.set", async (span) => {
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key,
            "blobs.method": "PUT",
            "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
            "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
            "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
          });
          _Store.validateKey(key);
          const conditions = _Store.getConditions(options);
          const res = await this.client.makeRequest({
            conditions,
            body: data,
            key,
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
      async setJSON(key, data, options = {}) {
        return withSpan(options.span, "blobs.setJSON", async (span) => {
          span?.setAttributes({
            "blobs.store": this.name,
            "blobs.key": key,
            "blobs.method": "PUT",
            "blobs.data.type": "json",
            "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
          });
          _Store.validateKey(key);
          const conditions = _Store.getConditions(options);
          const payload = JSON.stringify(data);
          const headers = {
            "content-type": "application/json"
          };
          const res = await this.client.makeRequest({
            conditions,
            body: payload,
            headers,
            key,
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
      static validateKey(key) {
        if (key === "") {
          throw new Error("Blob key must not be empty.");
        }
        if (key.startsWith("/") || key.startsWith("%2F")) {
          throw new Error("Blob key must not start with forward slash (/).");
        }
        if (new TextEncoder().encode(key).length > 600) {
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
async function cached(rawKey, ttlSec, fn, opts = {}) {
  const key = CACHE_VERSION + ":" + rawKey;
  const now = Date.now();
  if (!opts.force) {
    const m = mem.get(key);
    if (m && m.exp > now) return { value: m.v.value, cachedAt: m.v.cachedAt, fromCache: true };
    const s = await kv("cache").get(key).catch(() => null);
    if (s && s.exp > now) {
      mem.set(key, { exp: s.exp, v: s });
      return { value: s.value, cachedAt: s.cachedAt, fromCache: true };
    }
  }
  const value = await fn();
  const rec = { exp: now + ttlSec * 1e3, value, cachedAt: new Date(now).toISOString() };
  mem.set(key, { exp: rec.exp, v: rec });
  if (mem.size > 500) {
    const first = mem.keys().next().value;
    if (first) mem.delete(first);
  }
  await kv("cache").set(key, rec).catch(() => void 0);
  return { value, cachedAt: rec.cachedAt, fromCache: false };
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

// server/meta/assets.ts
async function businesses(g, force = false) {
  return cached("biz:list", TTL.accounts, async () => {
    const list2 = await g.all("me/businesses", { fields: "id,name,verification_status,created_time" }).catch((e) => {
      if (e.info?.category === "permission_missing") return [];
      throw e;
    });
    return list2.map((b) => ({ id: b.id, name: b.name, verification: b.verification_status }));
  }, { force });
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
async function adAccounts(g, force = false) {
  return cached("acc:list", TTL.accounts, async () => {
    const seen = /* @__PURE__ */ new Map();
    const direct = await g.all("me/adaccounts", { fields: ACCOUNT_FIELDS }, 25);
    direct.forEach((a) => seen.set(a.id, mapAccount(a)));
    const biz = (await businesses(g, force)).value;
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
  }, { force });
}
function actId(id) {
  const s = String(id);
  return s.startsWith("act_") ? s : "act_" + s;
}
var ACCOUNT_STATUS, TTL, ACCOUNT_FIELDS;
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
    TTL = { accounts: 600, assets: 900, audiences: 600, events: 600, structure: 120 };
    ACCOUNT_FIELDS = "id,account_id,name,currency,timezone_name,account_status,disable_reason,amount_spent,spend_cap,min_daily_budget,business{id,name}";
  }
});

// server/meta/token.ts
async function listConnections() {
  const keys = await kv("core").list("metaconn/");
  return (await Promise.all(keys.map((k) => kv("core").get(k)))).filter(Boolean);
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
  const key = t.source + ":" + (t.connectionId || "") + ":" + t.token.slice(-8);
  if (graphCache?.key === key) return graphCache.g;
  graphCache = { key, g: new Graph(t.token, { label: t.label }) };
  return graphCache.g;
}
async function tokenHealth() {
  const checks = [];
  const add2 = (c) => checks.push(c);
  let t;
  try {
    t = await activeToken();
  } catch (e) {
    add2({ group: "Token", item: "Token configurado", status: "error", detail: e.info?.cause || e.message, fix: e.info?.recommendation });
    return { source: "env", label: "\u2014", checks, scopes: [], checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const g = new Graph(t.token, { label: t.label });
  const vnum = Number(env.metaVersion.replace(/^v/, "").split(".")[0]) || 0;
  add2({
    group: "API",
    item: "Versi\xF3n de la API",
    status: vnum < API_MIN ? "error" : vnum < API_TARGET ? "warning" : "ok",
    detail: `META_API_VERSION = ${env.metaVersion}.` + (vnum < API_MIN ? " Meta ya retir\xF3 esta versi\xF3n." : vnum < API_TARGET ? ` Funciona, pero la versi\xF3n vigente es v${API_TARGET}.0.` : ""),
    fix: vnum < API_TARGET ? `Cambia META_API_VERSION a v${API_TARGET}.0 en Netlify (y en n8n) y vuelve a publicar. Desde v26.0 Meta exige is_adset_budget_sharing_enabled en campa\xF1as sin presupuesto de campa\xF1a y retir\xF3 GET /?ids= y las ubicaciones Explorar de Instagram e Historias de Messenger; la plataforma ya lo contempla.` : void 0
  });
  add2({
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
    add2({ group: "Token", item: "Validez", status: "error", detail: `${e.info?.message} [${e.info?.code}${e.info?.subcode ? "/" + e.info.subcode : ""}]`, fix: e.info?.recommendation, meta: e.info });
    return { source: t.source, label: t.label, checks, scopes: [], checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  add2({ group: "Token", item: "Validez", status: "ok", detail: `Token v\xE1lido de "${me.name}" (${me.id}).` });
  const d = dbg.__err ? null : dbg.data;
  let tokenType, expiresAt;
  if (d) {
    tokenType = d.type;
    expiresAt = Number(d.expires_at) ? Number(d.expires_at) * 1e3 : null;
    const days = expiresAt ? (expiresAt - Date.now()) / 864e5 : null;
    add2({
      group: "Token",
      item: "Tipo y vencimiento",
      status: d.is_valid === false ? "error" : days !== null && days < 7 ? "error" : days !== null && days < 20 ? "warning" : "ok",
      detail: `${d.type === "SYSTEM_USER" ? "System user" : "Token de " + (d.type || "tipo desconocido")}${expiresAt ? ", vence el " + new Date(expiresAt).toISOString().slice(0, 10) + ` (${Math.max(0, Math.floor(days))} d\xEDas)` : ", no vence"}.`,
      fix: d.type !== "SYSTEM_USER" ? "Para una agencia conviene un token de system user (no vence ni depende de una persona). Si usas Facebook Login, la herramienta avisar\xE1 antes del vencimiento." : void 0
    });
    if (Number(d.data_access_expires_at)) {
      const da = Number(d.data_access_expires_at) * 1e3;
      const dd = (da - Date.now()) / 864e5;
      add2({ group: "Token", item: "Acceso a datos", status: dd < 7 ? "error" : dd < 20 ? "warning" : "ok", detail: `El acceso a datos vence el ${new Date(da).toISOString().slice(0, 10)}.`, fix: dd < 20 ? "Reconecta Meta para renovar el acceso a datos (90 d\xEDas)." : void 0 });
    }
  } else add2({ group: "Token", item: "Tipo y vencimiento", status: "info", detail: "No se pudo leer debug_token (configura META_APP_ID/META_APP_SECRET para verlo)." });
  const granted = perms.__err ? [] : perms.filter((p) => p.status === "granted").map((p) => p.permission);
  const scopes = granted.length ? granted : d?.scopes || [];
  const missing = Object.keys(REQUIRED_SCOPES).filter((s) => !scopes.includes(s));
  add2({
    group: "Permisos",
    item: "Permisos necesarios",
    status: missing.length ? "error" : "ok",
    detail: missing.length ? "Faltan: " + missing.map((s) => `${s} (${REQUIRED_SCOPES[s]})`).join(", ") + "." : `Tiene los ${Object.keys(REQUIRED_SCOPES).length} permisos que usa la plataforma.`,
    fix: missing.length ? "Regenera el token del system user marcando esos permisos (Business Manager \u2192 Usuarios del sistema \u2192 Generar token)." : void 0
  });
  const opt = Object.keys(OPTIONAL_SCOPES).filter((s) => !scopes.includes(s));
  if (opt.length) add2({ group: "Permisos", item: "Permisos opcionales", status: "info", detail: "Sin " + opt.map((s) => `${s} (${OPTIONAL_SCOPES[s]})`).join(", ") + "." });
  const declined = perms.__err ? [] : perms.filter((p) => p.status === "declined").map((p) => p.permission);
  if (declined.length) add2({ group: "Permisos", item: "Permisos rechazados", status: "warning", detail: "El usuario rechaz\xF3: " + declined.join(", ") + ".", fix: "Vuelve a conectar y acepta todos los permisos." });
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

// netlify/functions/sync-background.mts
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
function fail(code, message, subcode, userMsg, blame, status = 400) {
  return ok({ error: {
    message,
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

// netlify/functions/sync-background.mts
init_env();
init_store();
init_assets();
init_token();

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
function periodRange(key, today, custom) {
  const t = /* @__PURE__ */ new Date(today + "T00:00:00Z");
  let since, until;
  switch (key) {
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
  if (key === "this_month") {
    pSince = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
    pUntil = addDays(pSince, days - 1);
  } else if (key === "last_month") {
    pSince = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() - 1, 1));
    pUntil = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 0));
  } else {
    pUntil = addDays(since, -1);
    pSince = addDays(pUntil, -(days - 1));
  }
  return { since: ymd(since), until: ymd(until), prevSince: ymd(pSince), prevUntil: ymd(pUntil), days };
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
var ROLE_PERMISSIONS = {
  admin: [...PERMISSIONS],
  director: ["read", "edit", "publish", "publish_budget_increase", "create", "delete", "audiences", "rules", "rules_execute", "templates", "plan", "audit"],
  coordinador: ["read", "edit", "publish", "create", "delete", "audiences", "rules", "templates", "plan", "audit"],
  analista: ["read", "edit", "create", "audiences", "rules"],
  lectura: ["read"]
};

// server/lib/dates.ts
function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
  } catch {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
}

// server/meta/entities.ts
init_currency();
init_store();
init_assets();
var CAMPAIGN_FIELDS = "id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,start_time,stop_time,is_adset_budget_sharing_enabled,issues_info,created_time,updated_time,spend_cap";
var ADSET_FIELDS = "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,bid_amount,bid_strategy,billing_event,optimization_goal,destination_type,promoted_object,targeting,start_time,end_time,attribution_spec,learning_stage_info,issues_info,created_time,updated_time";
var CREATIVE_FIELDS = "id,name,object_story_spec,asset_feed_spec,url_tags,thumbnail_url,image_url,image_hash,video_id,call_to_action_type,effective_object_story_id,object_story_id,degrees_of_freedom_spec,body,title,link_url";
var AD_FIELDS = `id,name,adset_id,campaign_id,status,effective_status,ad_review_feedback,issues_info,created_time,updated_time,creative{${CREATIVE_FIELDS}}`;
var issues = (x) => x?.issues_info?.length ? x.issues_info.map((i) => i.error_summary || i.error_message || String(i.error_code)) : void 0;
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
var DEFAULT_STATUSES = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"];
async function structure(g, accountId, currency, o = {}) {
  const act = actId(accountId);
  const statuses = o.statuses?.length ? o.statuses : DEFAULT_STATUSES;
  const key = `struct:${act}:${statuses.slice().sort().join(",")}`;
  return cached(key, 120, async () => {
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
  const key = `ins:${act}:${q.level}:${q.since}:${q.until}:${q.breakdown || "none"}:${(q.ids || []).join(",")}`;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const ttl = q.until >= today ? 300 : 3600 * 6;
  return cached(key, ttl, async () => {
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

// server/analytics.ts
function add(a, b) {
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
    (byId.get(id) || []).filter((d) => d.date >= since && d.date <= until).forEach((d) => add(t, d.m));
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

// server/auth/session.ts
init_crypto();
init_store();

// server/auth/users.ts
init_env();
init_store();

// server/auth/session.ts
var IDLE_MS = 12 * 3600 * 1e3;
var ABSOLUTE_MS = 7 * 24 * 3600 * 1e3;
var REFRESH_MS = 15 * 60 * 1e3;

// server/routes/admin.ts
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

// server/routes/admin.ts
init_crypto();
init_store();
init_assets();
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

// netlify/functions/sync-background.mts
var sync_background_default = async () => {
  if (env.metaMode === "mock") setTransport(mockTransport);
  const started = (/* @__PURE__ */ new Date()).toISOString();
  const out = { started };
  try {
    const g = await graph();
    out.accounts = (await adAccounts(g, true)).value.length;
    const h = await tokenHealth();
    out.tokenIssues = h.checks.filter((c) => c.status === "error" || c.status === "warning").map((c) => c.item + ": " + c.detail);
    const r = await runRules(null, "sistema:sincronizaci\xF3n", { execute: true });
    out.alerts = r.matches.length;
    out.executed = r.executed.length;
  } catch (e) {
    out.error = e.info?.message || e.message;
    console.error("[sync]", e);
  }
  out.finished = (/* @__PURE__ */ new Date()).toISOString();
  await kv("core").set("sync/background", out);
  console.log("[sync]", JSON.stringify(out));
};
var config = { schedule: "@hourly" };
export {
  config,
  sync_background_default as default
};
