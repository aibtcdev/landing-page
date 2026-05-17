/**
 * Live D1 mirror for the `agents` table.
 *
 * Before this module, D1 `agents` was populated only by the admin backfill
 * job (`app/api/admin/backfill/route.ts:260`), making it a hours-to-days-old
 * snapshot of the canonical KV `stx:`/`btc:` records. That meant any read
 * flipped from KV to D1 would miss newly-registered agents.
 *
 * This mirror is **purely additive** — it writes to D1 alongside the
 * existing KV writes, preserving KV as the current source-of-truth while
 * making D1 a co-equal store that subsequent P3a–e read flips can rely on.
 *
 * Same shape as `lib/claims/d1-mirror.ts`. **D1 errors propagate to the
 * caller** — every wiring site is responsible for try/catch + logging.
 * This is intentional: the mirror should not be silently swallowed in a
 * helper that's reused across many call paths with different log contexts.
 * The one exception is the second-pass `referred_by_btc` UPDATE inside
 * `insertAgentToD1`, which intentionally swallows FK violations (see
 * function-level doc below).
 */

import type { AgentRecord } from "@/lib/types";

/**
 * Mirror a newly-registered agent into D1. Called from the registration
 * flow once both the KV writes and the referral-code generation have
 * succeeded. Uses `ON CONFLICT(btc_address) DO NOTHING` so a re-fired
 * registration (idempotent retry from the client) does not corrupt an
 * existing row.
 *
 * Inserts with `referred_by_btc = NULL` first to avoid the FK constraint
 * to `agents(btc_address)` rejecting the row when the referrer hasn't
 * yet been mirrored. After the insert, if the agent has a `referredBy`,
 * a best-effort UPDATE attempts to set it; FK violations are swallowed
 * because the referrer may not be in D1 yet — the admin backfill job
 * will hydrate the relationship on its next run.
 */
export async function insertAgentToD1(
  db: D1Database | undefined,
  agent: AgentRecord,
  referralCode: string
): Promise<void> {
  if (!db) return;

  await db
    .prepare(
      `INSERT INTO agents (
         btc_address, stx_address, stx_public_key, btc_public_key,
         taproot_address, display_name, description, bns_name,
         owner, verified_at, last_active_at, erc8004_agent_id,
         nostr_public_key, capabilities_json, last_identity_check,
         github_username, referred_by_btc, referral_code
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(btc_address) DO NOTHING`
    )
    .bind(
      agent.btcAddress,
      agent.stxAddress,
      agent.stxPublicKey,
      // btc_public_key is NULLable (migration 008): null when absent/empty.
      agent.btcPublicKey || null,
      agent.taprootAddress ?? null,
      agent.displayName ?? null,
      agent.description ?? null,
      agent.bnsName ?? null,
      agent.owner ?? null,
      agent.verifiedAt,
      agent.lastActiveAt ?? null,
      agent.erc8004AgentId ?? null,
      agent.nostrPublicKey ?? null,
      agent.capabilities ? JSON.stringify(agent.capabilities) : null,
      agent.lastIdentityCheck ?? null,
      agent.githubUsername ?? null,
      referralCode
    )
    .run();

  // Best-effort second pass: set `referred_by_btc` if the agent has one.
  // FK to `agents(btc_address)` may reject if the referrer isn't yet in D1
  // — that's fine; the admin backfill will close the gap on its next run.
  if (agent.referredBy) {
    try {
      await db
        .prepare(
          "UPDATE agents SET referred_by_btc = ? WHERE btc_address = ? AND referred_by_btc IS NULL"
        )
        .bind(agent.referredBy, agent.btcAddress)
        .run();
    } catch {
      // Referrer not yet in D1; backfill will fill this in. Swallowed.
    }
  }
}

/**
 * Mirror a mutated agent into D1. Called from every site that updates a
 * KV `stx:`/`btc:` AgentRecord (heartbeat, challenge, verify, identity, etc.).
 *
 * Wiring scheduled for P3-0b — this helper is defined now so the contract
 * is reviewable alongside `insertAgentToD1`, and so individual mutator
 * call sites can be wired in small follow-up PRs without re-introducing
 * the helper.
 *
 * Updates only fields that can change post-registration. Immutable fields
 * (btc_address, stx_address, public keys, verified_at, referral_code) are
 * never touched here — they are set by `insertAgentToD1` at registration.
 *
 * If no row exists for the agent (i.e. registered before this mirror was
 * deployed and not yet backfilled), the UPDATE silently no-ops. That is
 * acceptable because the admin backfill job will hydrate the row on its
 * next run, picking up the latest KV state.
 */
export async function updateAgentInD1(
  db: D1Database | undefined,
  agent: AgentRecord
): Promise<void> {
  if (!db) return;

  await db
    .prepare(
      `UPDATE agents SET
         taproot_address = ?,
         display_name = ?,
         description = ?,
         bns_name = ?,
         owner = ?,
         last_active_at = ?,
         erc8004_agent_id = ?,
         nostr_public_key = ?,
         capabilities_json = ?,
         last_identity_check = ?,
         github_username = ?,
         referred_by_btc = COALESCE(?, referred_by_btc),
         btc_public_key = COALESCE(?, btc_public_key)
       WHERE btc_address = ?`
    )
    .bind(
      agent.taprootAddress ?? null,
      agent.displayName ?? null,
      agent.description ?? null,
      agent.bnsName ?? null,
      agent.owner ?? null,
      agent.lastActiveAt ?? null,
      agent.erc8004AgentId ?? null,
      agent.nostrPublicKey ?? null,
      agent.capabilities ? JSON.stringify(agent.capabilities) : null,
      agent.lastIdentityCheck ?? null,
      agent.githubUsername ?? null,
      // referredBy is immutable once set; COALESCE preserves the existing
      // value when the incoming AgentRecord omits referredBy (most mutators
      // don't touch this field). A non-null incoming value still wins.
      agent.referredBy ?? null,
      // btcPublicKey is opportunistic — COALESCE preserves a previously
      // captured value if the current write has none (update-pubkey is
      // a one-time challenge action).
      agent.btcPublicKey || null,
      agent.btcAddress
    )
    .run();
}
