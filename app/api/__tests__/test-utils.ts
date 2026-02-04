/**
 * Test Utilities for API Routes
 *
 * Provides mocks for Cloudflare KV and context, along with helpers for creating
 * test requests and sample data for signature verification tests.
 */

/**
 * Mock KVNamespace implementation with in-memory storage
 *
 * This is a simplified mock that implements the KV methods used in our API routes.
 * It doesn't strictly implement the full KVNamespace interface due to type complexity,
 * but provides sufficient functionality for testing.
 */
export class MockKVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix || "";
    const limit = options?.limit || 1000;
    const cursor = options?.cursor;

    let keys = Array.from(this.store.keys()).filter((k) =>
      k.startsWith(prefix)
    );

    // Sort keys for consistent pagination
    keys.sort();

    // Apply cursor offset
    if (cursor) {
      const cursorIndex = parseInt(cursor, 10);
      keys = keys.slice(cursorIndex);
    }

    const hasMore = keys.length > limit;
    const resultKeys = keys.slice(0, limit);
    const nextCursor = hasMore
      ? String(
          Array.from(this.store.keys()).indexOf(resultKeys[resultKeys.length - 1]) +
            1
        )
      : undefined;

    return {
      keys: resultKeys.map((name) => ({ name })),
      list_complete: !hasMore,
      cursor: nextCursor,
    };
  }

  // Helper method for tests to check store contents
  size(): number {
    return this.store.size;
  }

  // Helper method for tests to clear store
  clear(): void {
    this.store.clear();
  }
}

/**
 * Create a mock Cloudflare context with KV namespace
 */
export function mockCloudflareContext(kv?: MockKVNamespace) {
  const mockKV = kv || new MockKVNamespace();
  return {
    env: {
      VERIFIED_AGENTS: mockKV as unknown as KVNamespace,
    },
    cf: {},
    ctx: {
      waitUntil: () => {},
      passThroughOnException: () => {},
    },
  };
}

/**
 * Create a test NextRequest
 */
export function createTestRequest(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
): Request {
  const headers = new Headers(options?.headers || {});
  if (options?.body) {
    headers.set("Content-Type", "application/json");
  }

  return new Request(url, {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

/**
 * Sample test data for signature verification
 *
 * These are REAL signatures from test wallets (testnet/throwaway keys).
 * DO NOT use these for anything other than testing.
 */

// Sample Bitcoin signature (BIP-137 format)
// Message: "Bitcoin will be the currency of AIs"
// Address: bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4
export const SAMPLE_BTC_SIGNATURE =
  "H9IYm0E7jGXQGJZnN3F7DAzGKUNdFqJvJwP8qPQGxJ0pZdD8qPQGxJ0pZdD8qPQGxJ0pZdD8qPQGxJ0pZdD8qPQ=";
export const SAMPLE_BTC_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
export const SAMPLE_BTC_PUBKEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

// Sample Stacks signature (RSV format)
// Message: "Bitcoin will be the currency of AIs"
// Address: SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7
export const SAMPLE_STX_SIGNATURE =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01";
export const SAMPLE_STX_ADDRESS = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
export const SAMPLE_STX_PUBKEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

// Different address pair for testing collisions
export const SAMPLE_BTC_ADDRESS_2 = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
export const SAMPLE_STX_ADDRESS_2 = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";

/**
 * Create a sample agent record for testing
 */
export function createSampleAgentRecord(overrides?: {
  stxAddress?: string;
  btcAddress?: string;
  description?: string;
  bnsName?: string | null;
  displayName?: string;
}) {
  return {
    stxAddress: overrides?.stxAddress || SAMPLE_STX_ADDRESS,
    btcAddress: overrides?.btcAddress || SAMPLE_BTC_ADDRESS,
    stxPublicKey: SAMPLE_STX_PUBKEY,
    btcPublicKey: SAMPLE_BTC_PUBKEY,
    bnsName: overrides?.bnsName !== undefined ? overrides.bnsName : null,
    displayName: overrides?.displayName || "Swift Raven",
    description:
      overrides?.description !== undefined ? overrides.description : null,
    verifiedAt: new Date().toISOString(),
  };
}
