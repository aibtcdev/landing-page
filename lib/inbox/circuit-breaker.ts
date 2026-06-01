/**
 * Circuit breaker for x402 relay calls.
 *
 * P4 (this file): rewritten to use the Cloudflare `ratelimits` binding
 * (`RATE_LIMIT_RELAY_FAILURES`, 10 failures / 60s) for the atomic
 * threshold counter, and `caches.default` for the per-colo
 * "circuit-open" memo. Replaces the KV-RMW counter pattern that lived
 * here pre-P4 — same TOCTOU and unbounded-no-atomic-increment problems
 * the heartbeat fix retired in P2 / PR #889.
 *
 * Behavior:
 * - Closed: relay calls proceed.
 * - Open: relay calls are blocked; callers return 503 with the
 *   `RELAY_CIRCUIT_BREAKER_RETRY_AFTER_SECONDS` `Retry-After` header.
 *
 * Per-colo: `caches.default` is colo-scoped. Different colos may have
 * different views of relay health, which is desirable — a degraded
 * route to the relay opens that colo's breaker without affecting healthy
 * colos. See phases/P4/design-call.md.
 *
 * All branches fail open: a transient binding/cache error never blocks
 * an otherwise valid payment request.
 */

import type { Logger } from "@/lib/logging";
import {
  RELAY_CIRCUIT_BREAKER_TTL_SECONDS,
  RELAY_CIRCUIT_BREAKER_BINDING_LIMIT,
  RELAY_CIRCUIT_BREAKER_BINDING_PERIOD_SECONDS,
} from "./constants";

/** Result of a circuit breaker check. */
export interface CircuitBreakerState {
  open: boolean;
}

/**
 * Synthetic cache URL for the "circuit-open" memo. Uses the same
 * `cache.aibtc.local` host pattern as `lib/edge-cache.ts` to stay out
 * of the live domain's HTTP cache namespace.
 */
const CIRCUIT_OPEN_CACHE_URL = "https://cache.aibtc.local/inbox/circuit-breaker-open";

/**
 * Resolve `caches.default` if available (Cloudflare Workers runtime).
 * Returns null in Node / `next dev` — callers fall through to closed
 * (fail-open) so payments aren't blocked outside Workers.
 */
function getDefaultCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

/**
 * Check whether the circuit breaker is currently open.
 *
 * Reads the per-colo "open" memo from `caches.default` — does NOT
 * consume a ratelimits binding slot. Returns `{ open: false }` on any
 * error (fail-open).
 */
export async function checkCircuitBreaker(
  logger?: Logger
): Promise<CircuitBreakerState> {
  try {
    const cache = getDefaultCache();
    if (!cache) return { open: false };
    const cached = await cache.match(new Request(CIRCUIT_OPEN_CACHE_URL));
    // Truthy check (not `!== undefined`) — Cache match semantics across
    // runtimes return either `undefined` or `null` on miss; treating
    // either as "no marker" is safer than just checking !== undefined
    // (Copilot PR #894 feedback).
    return { open: !!cached };
  } catch (e) {
    logger?.warn?.("circuit-breaker.check_failed", { error: String(e) });
    return { open: false };
  }
}

/**
 * Record a relay failure. Calls the ratelimits binding to atomically
 * count failures per 60s rolling window (threshold = 10, set on the
 * binding in wrangler.jsonc). When the binding returns
 * `success: false`, writes the "open" marker to `caches.default` with
 * a 60s TTL so subsequent `checkCircuitBreaker()` calls short-circuit
 * without consuming binding slots.
 *
 * Silently swallows binding / cache errors — circuit-breaker behavior
 * degrades to "closed" rather than failing the payment request.
 */
export async function recordRelayFailure(
  env: CloudflareEnv,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
  logger?: Logger
): Promise<void> {
  try {
    const binding = env.RATE_LIMIT_RELAY_FAILURES;
    if (!binding) {
      logger?.warn?.("circuit-breaker.binding_missing");
      return;
    }
    const { success } = await binding.limit({ key: "relay-failures" });
    if (success) return; // still under threshold — circuit stays closed

    // Threshold exceeded — write the per-colo "open" memo.
    const cache = getDefaultCache();
    if (!cache) return;
    const body = JSON.stringify({ openedAt: new Date().toISOString() });
    const response = new Response(body, {
      headers: {
        "Cache-Control": `public, max-age=${RELAY_CIRCUIT_BREAKER_TTL_SECONDS}, s-maxage=${RELAY_CIRCUIT_BREAKER_TTL_SECONDS}`,
        "Content-Type": "application/json",
      },
    });
    const put = cache.put(new Request(CIRCUIT_OPEN_CACHE_URL), response);
    if (ctx?.waitUntil) {
      ctx.waitUntil(put);
    } else {
      await put;
    }
    // Log the actual trip threshold (binding: 10 failures / 60s) AND the
    // marker TTL separately. The old single `thresholdSeconds` field carried
    // the marker TTL but read as the failure-rate threshold — a conflation that
    // would silently misfire any alert rule if the TTL were ever retuned
    // independently of the binding window (#895).
    logger?.warn?.("circuit-breaker.opened", {
      bindingLimit: RELAY_CIRCUIT_BREAKER_BINDING_LIMIT,
      bindingPeriodSeconds: RELAY_CIRCUIT_BREAKER_BINDING_PERIOD_SECONDS,
      markerTtlSeconds: RELAY_CIRCUIT_BREAKER_TTL_SECONDS,
    });
  } catch (e) {
    logger?.warn?.("circuit-breaker.record_failed", { error: String(e) });
  }
}

/**
 * Reset the circuit breaker after a successful relay call. Deletes the
 * per-colo "open" memo from `caches.default`. The ratelimits binding's
 * rolling 60s window is NOT explicitly reset — the binding has no public
 * reset method, and the window self-heals after a quiet period.
 *
 * Semantic change from the pre-P4 KV-RMW implementation (Codex PR #894
 * P1 feedback):
 *
 *   Pre-P4: a single successful relay call wiped the failure counter,
 *           so the breaker required `RELAY_CIRCUIT_BREAKER_THRESHOLD`
 *           *consecutive* failures within a 60s window to trip.
 *
 *   Post-P4: the binding counts ALL failures in any rolling 60s window
 *           regardless of intermixed successes. A relay with 9 failures
 *           and 1 success in 60s then 1 more failure 50s later WILL trip.
 *
 * This is intentional and more conservative — a relay showing 10
 * failures within a minute is degraded regardless of whether those
 * failures are interleaved with successes. Acceptable for the
 * circuit-breaker semantic per `phases/P4/design-call.md`. The 60s
 * window self-heals naturally after a quiet period (no resets needed).
 *
 * Silently swallows cache errors so a successful relay settlement is
 * never disrupted by a cache issue.
 */
export async function resetCircuitBreaker(
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
  logger?: Logger
): Promise<void> {
  try {
    const cache = getDefaultCache();
    if (!cache) return;
    const del = cache.delete(new Request(CIRCUIT_OPEN_CACHE_URL));
    if (ctx?.waitUntil) {
      ctx.waitUntil(del.then(() => undefined));
    } else {
      await del;
    }
  } catch (e) {
    logger?.warn?.("circuit-breaker.reset_failed", { error: String(e) });
  }
}
