import {
  deserializeCV,
  principalCV,
  serializeCV,
  cvToJSON,
} from "@stacks/transactions";
import { hexToBytes, bytesToUtf8 } from "@stacks/common";
import {
  getCachedBnsName,
  setCachedBnsName,
  setCachedBnsNegative,
  setCachedBnsLookupFailed,
  setCachedBnsContractError,
  BNS_NONE_SENTINEL,
  type LookupOutcomeState,
} from "./identity/kv-cache";
import { buildHiroHeaders } from "./identity/stacks-api";
import { stacksApiFetch } from "./stacks-api-fetch";
import { STACKS_API_BASE } from "./identity/constants";
import type { Logger } from "./logging";

const BNS_V2_CONTRACT = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";
const BNS_V2_NAME = "BNS-V2";

// BNS-V2 error code returned by `get-primary` when the address has no
// primary name. Treated as an authoritative "no name" signal and cached
// with the confirmed-negative (7d) TTL.
const BNS_ERR_NO_PRIMARY_NAME = "131";

/**
 * Tri-state BNS lookup outcome.
 *
 * - `"positive"` — Hiro returned a name; `name` is set.
 * - `"confirmed-negative"` — Hiro returned `(ok none)`. Authoritative "no name".
 * - `"lookup-failed"` — transient upstream error (429/5xx/timeout/parse) or
 *   contract-reported error. We don't know whether the address has a name.
 *
 * Callers that mirror lookup results into persistent storage (e.g. the
 * refresh endpoint) should skip the write on `"lookup-failed"` — overwriting
 * a verified `bnsName` with `null` during a Hiro incident would corrupt the
 * AgentRecord.
 */
export type BnsLookupOutcome =
  | { state: "positive"; name: string }
  | { state: "confirmed-negative"; name: null }
  | { state: "lookup-failed"; name: null };

/**
 * Internal: run the BNS-V2 `get-primary` lookup and return the tri-state
 * outcome. Populates the KV cache with the appropriate TTL for each branch.
 *
 * Use {@link lookupBnsName} for callers that only need `string | null`.
 */
export async function lookupBnsNameWithOutcome(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<BnsLookupOutcome> {
  const cached = await getCachedBnsName(stxAddress, kv, logger);
  if (cached === BNS_NONE_SENTINEL) {
    // We can't tell from the cache alone whether this was confirmed-negative
    // or lookup-failed (both write NONE_SENTINEL, only TTL differs). Treat
    // any cached NONE_SENTINEL as confirmed-negative for return-type purposes
    // — callers that care about the distinction should bust the cache first.
    return { state: "confirmed-negative", name: null };
  }
  if (cached) return { state: "positive", name: cached };

  try {
    const principal = principalCV(stxAddress);
    const serialized = serializeCV(principal);

    const headers = buildHiroHeaders(hiroApiKey);
    headers["Content-Type"] = "application/json";

    // BNS lookup runs on request paths (register, verify, SSR). Use a reduced
    // retry budget so a degraded Hiro cannot block requests for tens of seconds.
    const res = await stacksApiFetch(
      `${STACKS_API_BASE}/v2/contracts/call-read/${BNS_V2_CONTRACT}/${BNS_V2_NAME}/get-primary`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          sender: stxAddress,
          arguments: [`0x${serialized}`],
        }),
      },
      { retries: 2, retries429: 1, logger }
    );

    if (!res.ok) {
      logger?.warn("bns.lookup_upstream_error", {
        stxAddress,
        status: res.status,
      });
      await setCachedBnsLookupFailed(stxAddress, kv, logger);
      return { state: "lookup-failed", name: null };
    }

    const data = (await res.json()) as { okay: boolean; result: string };
    if (!data.okay) {
      // Contract-reported error. For BNS V2 `get-primary` against a valid
      // principal this branch is practically unreachable — when it does fire
      // it's usually deterministic (malformed principal), so use the 5-min
      // contract-error TTL rather than the 60s lookup-failed TTL. Still
      // classified as `lookup-failed` so callers that mirror to the
      // AgentRecord skip the write.
      logger?.warn("bns.lookup_contract_error", { stxAddress });
      await setCachedBnsContractError(stxAddress, kv, logger);
      return { state: "lookup-failed", name: null };
    }

    const cv = deserializeCV(data.result);
    const json = cvToJSON(cv);

    // BNS-V2 `get-primary` response shape, per contract source:
    //   (ok (some { name: (buff 48), namespace: (buff 20) })) — address has a primary name
    //   (err u131) ERR-NO-PRIMARY-NAME                        — address has no primary name
    // The `(ok none)` branch below is defense-in-depth in case the contract
    // ever emits an empty optional for "no primary name" instead of the err.
    if (!json.success) {
      const errCode = json.value?.value;
      if (errCode === BNS_ERR_NO_PRIMARY_NAME) {
        // Authoritative "no primary name" — cache as confirmed-negative (7d).
        await setCachedBnsNegative(stxAddress, kv, logger);
        return { state: "confirmed-negative", name: null };
      }
      logger?.warn("bns.lookup_malformed_response", { stxAddress, errCode });
      await setCachedBnsLookupFailed(stxAddress, kv, logger);
      return { state: "lookup-failed", name: null };
    }

    // Unwrap: response -> optional -> tuple
    const optional = json.value?.value;
    if (!optional) {
      await setCachedBnsNegative(stxAddress, kv, logger);
      return { state: "confirmed-negative", name: null };
    }

    const tuple = optional.value;
    if (!tuple?.name?.value || !tuple?.namespace?.value) {
      await setCachedBnsNegative(stxAddress, kv, logger);
      return { state: "confirmed-negative", name: null };
    }

    const name = bytesToUtf8(hexToBytes(tuple.name.value));
    const namespace = bytesToUtf8(hexToBytes(tuple.namespace.value));
    const fullName = `${name}.${namespace}`;

    await setCachedBnsName(stxAddress, fullName, kv, logger);
    return { state: "positive", name: fullName };
  } catch (e) {
    logger?.error("bns.lookup_failed", { stxAddress, error: String(e) });
    await setCachedBnsLookupFailed(stxAddress, kv, logger);
    return { state: "lookup-failed", name: null };
  }
}

/**
 * Look up the BNS name for a Stacks address using BNS-V2.
 *
 * Calls the `get-primary` read-only function on the BNS-V2 contract,
 * which returns the primary name+namespace for an owner address.
 *
 * BNS V1 is deprecated — all names have been migrated to V2.
 *
 * Returns the BNS name or null (both confirmed-negative and lookup-failed
 * collapse to null). Use {@link lookupBnsNameWithOutcome} if you need to
 * distinguish those two cases (e.g. to avoid overwriting a stored value
 * during a transient Hiro incident).
 *
 * @param stxAddress - Stacks address to lookup
 * @param hiroApiKey - Optional Hiro API key for authenticated requests
 * @param kv - Optional KV namespace for persistent caching
 * @param logger - Optional Logger for cache telemetry and error logging
 */
export async function lookupBnsName(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<string | null> {
  const outcome = await lookupBnsNameWithOutcome(
    stxAddress,
    hiroApiKey,
    kv,
    logger
  );
  return outcome.name;
}

// ---------------------------------------------------------------------------
// Reverse BNS lookup: BNS name → owner STX address
// ---------------------------------------------------------------------------

/**
 * Cache TTLs for the BNS owner lookup (name → STX address direction).
 *
 * Same three-state model as the forward lookup:
 *   24h positive / 7d confirmed-negative / 60s lookup-failed
 */
const BNS_OWNER_CACHE_TTL = 24 * 60 * 60; // 24h — confirmed owner address
const BNS_OWNER_NEGATIVE_TTL = 7 * 24 * 60 * 60; // 7d — confirmed no such name
const BNS_OWNER_FAILED_TTL = 60; // 60s — transient Hiro error

const BNS_OWNER_NONE_SENTINEL = "__NONE__";
const BNS_OWNER_CACHE_PREFIX = "cache:bns-owner:";

/**
 * Look up the owner STX address for a BNS name using Hiro's
 * `GET /v1/names/{name}` REST endpoint.
 *
 * This is the *reverse* direction: BNS name → STX address.
 * (The forward direction, STX address → BNS name, is handled by {@link lookupBnsName}.)
 *
 * Cache key prefix: `cache:bns-owner:{bnsName}`
 * TTLs follow the same three-state model as the forward lookup:
 *   - 24h  — Hiro returned an owner address (confirmed positive)
 *   - 7d   — Hiro returned 404 / no owner (confirmed name does not exist)
 *   - 60s  — Transient Hiro error (429 / 5xx / timeout / parse failure)
 *
 * @param bnsName - Full BNS name to look up (e.g. `"alice.btc"`)
 * @param hiroApiKey - Optional Hiro API key for authenticated requests
 * @param kv - Optional KV namespace for persistent caching
 * @param logger - Optional Logger for cache telemetry and error logging
 * @returns Resolved STX address, or null (confirmed-negative or lookup-failed)
 */
export async function lookupOwnerByBnsName(
  bnsName: string,
  hiroApiKey?: string,
  kv?: KVNamespace,
  logger?: Logger
): Promise<string | null> {
  // BNS names are case-insensitive on-chain; normalize to lowercase for cache key
  // to avoid cache fragmentation (e.g. "Alice.btc" and "alice.btc" share state).
  const normalizedBnsName = bnsName.toLowerCase();
  const cacheKey = `${BNS_OWNER_CACHE_PREFIX}${normalizedBnsName}`;

  // Cache read
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached !== null) {
        if (cached === BNS_OWNER_NONE_SENTINEL) return null;
        logger?.info("bns.owner_cache_hit", { bnsName });
        return cached;
      }
    } catch (e) {
      logger?.error("bns.owner_cache_read_failed", { bnsName, error: String(e) });
    }
  }

  const headers = buildHiroHeaders(hiroApiKey);

  try {
    const res = await stacksApiFetch(
      `${STACKS_API_BASE}/v1/names/${encodeURIComponent(bnsName)}`,
      { headers },
      { retries: 2, retries429: 1, logger }
    );

    if (res.status === 404) {
      // Confirmed: name does not exist. Cache as confirmed-negative (7d).
      logger?.info("bns.owner_not_found", { bnsName });
      if (kv) {
        await kv
          .put(cacheKey, BNS_OWNER_NONE_SENTINEL, {
            expirationTtl: BNS_OWNER_NEGATIVE_TTL,
          })
          .catch((e) =>
            logger?.error("bns.owner_cache_write_failed", { bnsName, error: String(e) })
          );
      }
      return null;
    }

    if (!res.ok) {
      logger?.warn("bns.owner_upstream_error", { bnsName, status: res.status });
      if (kv) {
        await kv
          .put(cacheKey, BNS_OWNER_NONE_SENTINEL, {
            expirationTtl: BNS_OWNER_FAILED_TTL,
          })
          .catch((e) =>
            logger?.error("bns.owner_cache_write_failed", { bnsName, error: String(e) })
          );
      }
      return null;
    }

    const data = (await res.json()) as {
      address?: string;
      owner?: string;
      zonefile_hash?: string;
    };

    // Hiro v1/names/{name} returns { address: "SP...", ... }
    const ownerAddress = data.address ?? data.owner ?? null;
    if (!ownerAddress || typeof ownerAddress !== "string") {
      logger?.warn("bns.owner_no_address_field", { bnsName });
      if (kv) {
        await kv
          .put(cacheKey, BNS_OWNER_NONE_SENTINEL, {
            expirationTtl: BNS_OWNER_FAILED_TTL,
          })
          .catch((e) =>
            logger?.error("bns.owner_cache_write_failed", { bnsName, error: String(e) })
          );
      }
      return null;
    }

    // Positive result — cache 24h
    if (kv) {
      await kv
        .put(cacheKey, ownerAddress, { expirationTtl: BNS_OWNER_CACHE_TTL })
        .catch((e) =>
          logger?.error("bns.owner_cache_write_failed", { bnsName, error: String(e) })
        );
    }
    logger?.info("bns.owner_resolved", { bnsName, ownerAddress });
    return ownerAddress;
  } catch (e) {
    logger?.error("bns.owner_lookup_failed", { bnsName, error: String(e) });
    if (kv) {
      await kv
        .put(cacheKey, BNS_OWNER_NONE_SENTINEL, {
          expirationTtl: BNS_OWNER_FAILED_TTL,
        })
        .catch((cacheErr) =>
          logger?.error("bns.owner_cache_write_failed", {
            bnsName,
            error: String(cacheErr),
          })
        );
    }
    return null;
  }
}

// Re-export for convenience so refresh-style callers can import once.
export type { LookupOutcomeState };
