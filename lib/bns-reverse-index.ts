/**
 * Maintained reverse index: `bns-lookup:{lowercased-name}` →
 * `btcAddress`.
 *
 * Lets BNS-name lookups skip the `agents:index` scan entirely — a
 * `.btc` resolution becomes 2 KV reads (`bns-lookup:` then
 * `btc:`) with no in-process iteration over an array of all
 * registered agents and no transfer of the ~130 KB index value.
 *
 * **Source of truth:** `stx:` and `btc:` AgentRecord entries.
 * **This index is a soft cache** maintained on every write that
 * mutates `bnsName`. Like the slim `agents:index`, callers MUST
 * re-fetch the source `btc:` record after the lookup and validate
 * the current `bnsName` matches the searched name — drift surfaces
 * as a 404 rather than incorrect data.
 *
 * Maintenance: an agent's bnsName transition is captured by
 * {@link syncBnsLookup}, which atomically deletes any old entry
 * and writes the new one. Best-effort — failures are logged, the
 * caller's primary write succeeds. Drift heals on the next
 * cold-miss `agents:index` rebuild (which doesn't touch this
 * index, so a separate recovery is documented in the cost
 * runbook: delete the affected `bns-lookup:` key + the agent's
 * stale entry will be repopulated on its next bns mutation).
 */

import type { Logger } from "./logging";

const BNS_LOOKUP_PREFIX = "bns-lookup:";

function bnsLookupKey(bnsName: string): string {
  return `${BNS_LOOKUP_PREFIX}${bnsName.toLowerCase()}`;
}

/**
 * Look up the canonical btcAddress associated with a BNS name.
 * Returns null on miss (no agent registered the name OR the index
 * is missing the entry).
 */
export async function lookupBtcAddressByBnsName(
  kv: KVNamespace,
  bnsName: string,
): Promise<string | null> {
  return await kv.get(bnsLookupKey(bnsName));
}

/**
 * Write the reverse-index entry for a name → btcAddress mapping.
 * Best-effort.
 */
async function setBnsLookup(
  kv: KVNamespace,
  bnsName: string,
  btcAddress: string,
  logger?: Logger,
): Promise<void> {
  try {
    await kv.put(bnsLookupKey(bnsName), btcAddress);
  } catch (e) {
    logger?.warn("bns_lookup.write_error", {
      bnsName,
      error: String(e),
    });
  }
}

/**
 * Delete the reverse-index entry for a name. Used on agent delete
 * and as half of a name transition (delete the old, write the
 * new). Best-effort.
 */
export async function deleteBnsLookup(
  kv: KVNamespace,
  bnsName: string,
  logger?: Logger,
): Promise<void> {
  try {
    await kv.delete(bnsLookupKey(bnsName));
  } catch (e) {
    logger?.warn("bns_lookup.delete_error", {
      bnsName,
      error: String(e),
    });
  }
}

/**
 * Maintain the reverse index across an agent's bnsName transition.
 *
 * - Pass `null`/`undefined` for `oldBnsName` on register (no prior
 *   entry to delete).
 * - Pass `null`/`undefined` for `newBnsName` on agent delete.
 * - When both old and new are present and identical, the call is a
 *   no-op. When they differ, the old entry is deleted and the new
 *   one is written in parallel.
 *
 * Best-effort: failures are logged; the caller's primary write to
 * `stx:`/`btc:` is what makes the change real. Index drift heals
 * on the next mutation of the affected name.
 */
export async function syncBnsLookup(
  kv: KVNamespace,
  oldBnsName: string | null | undefined,
  newBnsName: string | null | undefined,
  btcAddress: string,
  logger?: Logger,
): Promise<void> {
  const old = oldBnsName?.toLowerCase() ?? null;
  const next = newBnsName?.toLowerCase() ?? null;
  if (old === next) return;

  const ops: Promise<void>[] = [];
  if (old) ops.push(deleteBnsLookup(kv, old, logger));
  if (next) ops.push(setBnsLookup(kv, next, btcAddress, logger));
  await Promise.all(ops);
}
