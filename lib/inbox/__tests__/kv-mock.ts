/**
 * Shared KV namespace mocks for inbox test suites.
 *
 * Provides in-memory Map-backed implementations of KVNamespace for unit tests.
 */

/** Options captured from KV put() calls, used for TTL assertions. */
export interface PutCall {
  key: string;
  value: string;
  options?: KVNamespacePutOptions;
}

/**
 * Create a basic mock KV namespace backed by an in-memory Map.
 */
export function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({
      keys: [],
      list_complete: true,
      cursor: "",
      cacheStatus: null,
    }),
    getWithMetadata: async () => ({
      value: null,
      metadata: null,
      cacheStatus: null,
    }),
  } as unknown as KVNamespace;
}

/**
 * Create a mock KV namespace that also captures put() options (e.g. expirationTtl)
 * and exposes the underlying store for direct manipulation in tests.
 */
export function createMockKVWithOptions(): {
  kv: KVNamespace;
  store: Map<string, string>;
  putCalls: PutCall[];
} {
  const store = new Map<string, string>();
  const putCalls: PutCall[] = [];

  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (
      key: string,
      value: string,
      options?: KVNamespacePutOptions
    ) => {
      store.set(key, value);
      putCalls.push({ key, value, options });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({
      keys: [],
      list_complete: true,
      cursor: "",
      cacheStatus: null,
    }),
    getWithMetadata: async () => ({
      value: null,
      metadata: null,
      cacheStatus: null,
    }),
  } as unknown as KVNamespace;

  return { kv, store, putCalls };
}

/**
 * Create a KV namespace that throws on every operation.
 * Used to verify fail-open behavior in production code.
 */
export function createThrowingKV(): KVNamespace {
  return {
    get: async () => {
      throw new Error("KV read failure");
    },
    put: async () => {
      throw new Error("KV write failure");
    },
    delete: async () => {
      throw new Error("KV delete failure");
    },
    list: async () => {
      throw new Error("KV list failure");
    },
    getWithMetadata: async () => {
      throw new Error("KV getWithMetadata failure");
    },
  } as unknown as KVNamespace;
}
