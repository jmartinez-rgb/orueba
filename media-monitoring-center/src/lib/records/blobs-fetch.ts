import "server-only";

/** SDK 11.1.1 otherwise treats every non-412 conditional PUT as a success. */
export const checkedBlobsFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  const headers = new Headers(init?.headers);
  const method = init?.method?.toUpperCase() ?? "GET";
  const conditionalWrite = method === "PUT" && (headers.has("if-match") || headers.get("if-none-match") === "*");
  const missing = response.status === 404 && (method === "GET" || method === "DELETE");
  const conflict = response.status === 412 && conditionalWrite;
  if (!response.ok && !missing && !conflict) {
    // Never attach the URL, body, authorization headers or provider error.
    throw new Error("RECORDS_UNAVAILABLE");
  }
  return response;
};
