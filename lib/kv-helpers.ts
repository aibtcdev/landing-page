/**
 * Shared Cloudflare KV utility helpers.
 *
 * Provides type-safe wrappers around KV reads to avoid repeating
 * the kv.get + JSON.parse + try/catch pattern throughout the codebase.
 */

/**
 * Fetch a JSON-encoded value from KV and parse it.
 * Returns null if the key does not exist or the value cannot be parsed.
 */
export async function kvGetJson<T>(
  kv: KVNamespace,
  key: string
): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
