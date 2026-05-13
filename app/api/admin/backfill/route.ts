import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { isPartialAgentRecord } from "@/lib/types";
import type { AgentRecord, ClaimRecord } from "@/lib/types";
import type { VouchRecord } from "@/lib/vouch/types";
import type { InboxMessage, OutboxReply } from "@/lib/inbox/types";
import { deriveReplyD1Id } from "@/lib/inbox/d1-pk";
import { generateClaimCode } from "@/lib/claim-code";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { isStxAddress } from "@/lib/validation/address";

// ── Types ──────────────────────────────────────────────────────────────────

type TableTarget = "agents" | "claims" | "inbox_messages" | "vouches" | "all";

interface BackfillResult {
  table: TableTarget;
  dryRun: boolean;
  batchSize: number;
  inserted: number;
  inserted_null_btcpubkey: number;
  skipped_idempotent: number;
  skipped_partial: number;
  updated?: number;
  failed: { key: string; reason: string }[];
  cursor: string | null;
  duration_ms: number;
}

interface AccumulatedCounts {
  inserted: number;
  inserted_null_btcpubkey: number;
  skipped_idempotent: number;
  skipped_partial: number;
  /**
   * Rows that existed in D1 and were updated in place (claims-only, only
   * relevant when force=resync is set). Conflict-target row was matched
   * and its mutable columns (status, reward_txid, reward_satoshis,
   * tweet_url, tweet_author, claimed_at, display_name) were overwritten
   * from the KV source.
   */
  updated?: number;
  failed: { key: string; reason: string }[];
}

type AgentBackfillPass = "insert" | "referred_by";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Clamp batchSize to [10, 500], default 100.
 */
function parseBatchSize(raw: string | null): number {
  if (!raw) return 100;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(10, Math.min(500, n));
}

/**
 * Generate a unique 6-character referral code and write it to both KV keys
 * (referral-code:{btcAddress} and referral-lookup:{CODE}). Retries up to 3
 * times on a D1 UNIQUE conflict detected via the dry-run or live path.
 *
 * Returns the code on success; throws after 3 attempts.
 */
async function generateAndStoreReferralCodeForBackfill(
  kv: KVNamespace,
  db: D1Database,
  btcAddress: string,
  dryRun: boolean
): Promise<string> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateClaimCode();

    if (!dryRun) {
      // Check for collision in D1 before writing to KV
      const existing = await db
        .prepare("SELECT btc_address FROM agents WHERE referral_code = ?")
        .bind(code)
        .first<{ btc_address: string }>();

      if (existing) {
        // Collision — retry with a new code
        continue;
      }

      // Also guard against collisions in KV during partial migration windows.
      const existingLookup = await kv.get(`referral-lookup:${code}`);
      if (existingLookup && existingLookup !== btcAddress) {
        continue;
      }

      // Write to KV so it's persisted for future use
      const record = JSON.stringify({ code, createdAt: new Date().toISOString() });
      await Promise.all([
        kv.put(`referral-code:${btcAddress}`, record),
        kv.put(`referral-lookup:${code}`, btcAddress),
      ]);
    }

    return code;
  }
  throw new Error(
    `Failed to generate unique referral code for ${btcAddress} after ${MAX_ATTEMPTS} attempts`
  );
}

function decodeAgentCursor(cursor: string | null): { pass: AgentBackfillPass; kvCursor: string | null } {
  if (!cursor) return { pass: "insert", kvCursor: null };
  if (cursor.startsWith("referred_by:")) {
    return { pass: "referred_by", kvCursor: cursor.slice("referred_by:".length) || null };
  }
  if (cursor.startsWith("insert:")) {
    return { pass: "insert", kvCursor: cursor.slice("insert:".length) || null };
  }
  return { pass: "insert", kvCursor: cursor };
}

function encodeAgentCursor(pass: AgentBackfillPass, kvCursor: string | null): string | null {
  if (pass === "insert") {
    if (!kvCursor) return null;
    return `insert:${kvCursor}`;
  }
  return `referred_by:${kvCursor ?? ""}`;
}

async function resolveReplyRecipientBtcAddress(
  kv: KVNamespace,
  candidateAddress: string
): Promise<string | null> {
  if (!isStxAddress(candidateAddress)) return candidateAddress;

  const stxRecordRaw = await kv.get(`stx:${candidateAddress}`);
  if (!stxRecordRaw) return null;

  try {
    const parsed = JSON.parse(stxRecordRaw) as Partial<AgentRecord>;
    return typeof parsed.btcAddress === "string" ? parsed.btcAddress : null;
  } catch {
    return null;
  }
}

/**
 * Run agents backfill: scan `btc:` prefix, skip partials, INSERT OR IGNORE into agents.
 *
 * Returns accumulated counts + next cursor (null if scan complete).
 */
async function backfillAgents(
  kv: KVNamespace,
  db: D1Database,
  batchSize: number,
  cursor: string | null,
  dryRun: boolean
): Promise<AccumulatedCounts & { nextCursor: string | null }> {
  const counts: AccumulatedCounts = {
    inserted: 0,
    inserted_null_btcpubkey: 0,
    skipped_idempotent: 0,
    skipped_partial: 0,
    failed: [],
  };

  const { pass, kvCursor } = decodeAgentCursor(cursor);
  const listOpts: KVNamespaceListOptions = { prefix: "btc:", limit: batchSize };
  if (kvCursor) listOpts.cursor = kvCursor;

  const page = await kv.list(listOpts);

  for (const kvKey of page.keys) {
    const raw = await kv.get(kvKey.name);
    if (!raw) continue;

    let parsedAgentRecord: unknown;
    try {
      parsedAgentRecord = JSON.parse(raw);
    } catch {
      counts.failed.push({ key: kvKey.name, reason: "JSON parse error" });
      continue;
    }

    // Skip partial agent records — they lack stx_address / stx_public_key
    if (isPartialAgentRecord(parsedAgentRecord)) {
      if (pass === "insert") {
        counts.skipped_partial++;
      }
      continue;
    }

    const agent = parsedAgentRecord as AgentRecord;

    // Secondary partial-detection: records that slipped through isPartialAgentRecord
    // because btcPublicKey was absent (pre-type-enforcement production records).
    // Any record without stxAddress is a partial — intentionally not migrated.
    if (!agent.stxAddress || !agent.stxPublicKey) {
      if (pass === "insert") {
        counts.skipped_partial++;
      }
      continue;
    }

    // Validate remaining required fields for D1 insert.
    // btcPublicKey is NULLable in D1 (migration 008): agents registered via BIP-322
    // segwit (bc1q) have no capturable pubkey in the signature. Records with
    // stxAddress + stxPublicKey + btcAddress + verifiedAt are valid even when
    // btcPublicKey is absent or empty — they are inserted with btc_public_key = NULL.
    // Only missing verifiedAt is a true data error for a claimed-full agent.
    if (!agent.verifiedAt) {
      counts.failed.push({
        key: kvKey.name,
        reason: "Missing required AgentRecord field: verifiedAt",
      });
      continue;
    }

    // Track whether this record has no BTC pubkey (for operational reporting).
    const hasNullBtcPubkey = !agent.btcPublicKey;

    if (pass === "insert") {
      // Resolve or generate referral code
      let referralCode: string;
      try {
        const codeData = await kv.get(`referral-code:${agent.btcAddress}`);
        if (codeData) {
          const parsed = JSON.parse(codeData) as { code: string };
          referralCode = parsed.code;
        } else {
          // Missing referral code — generate and persist
          referralCode = await generateAndStoreReferralCodeForBackfill(
            kv,
            db,
            agent.btcAddress,
            dryRun
          );
        }
      } catch (e) {
        counts.failed.push({
          key: kvKey.name,
          reason: `Referral code error: ${(e as Error).message}`,
        });
        continue;
      }

      if (dryRun) {
        counts.inserted++;
        if (hasNullBtcPubkey) counts.inserted_null_btcpubkey++;
        continue;
      }

      try {
        const result = await db
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
            // btc_public_key is NULLable (migration 008): store null when absent/empty.
            // BIP-322 bc1q agents never had a capturable pubkey at registration time.
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

        if (result.meta.changes === 1) {
          counts.inserted++;
          if (hasNullBtcPubkey) counts.inserted_null_btcpubkey++;
        } else {
          counts.skipped_idempotent++;
        }
      } catch (e) {
        counts.failed.push({
          key: kvKey.name,
          reason: `D1 insert error: ${(e as Error).message}`,
        });
      }
      continue;
    }

    // Second pass: set referred_by_btc only after all agents exist.
    if (!agent.referredBy || dryRun) continue;

    try {
      await db
        .prepare(
          `UPDATE agents
             SET referred_by_btc = ?
           WHERE btc_address = ?
             AND (referred_by_btc IS NULL OR referred_by_btc != ?)`
        )
        .bind(agent.referredBy, agent.btcAddress, agent.referredBy)
        .run();
    } catch (e) {
      counts.failed.push({
        key: kvKey.name,
        reason: `D1 referral update error: ${(e as Error).message}`,
      });
    }
  }

  if (pass === "insert") {
    if (!page.list_complete) {
      return {
        ...counts,
        nextCursor: encodeAgentCursor("insert", page.cursor ?? null),
      };
    }
    return {
      ...counts,
      nextCursor: encodeAgentCursor("referred_by", null),
    };
  }

  return {
    ...counts,
    nextCursor: page.list_complete ? null : encodeAgentCursor("referred_by", page.cursor ?? null),
  };
}

/**
 * Run claims backfill: scan `claim:` prefix, INSERT OR IGNORE into claims.
 *
 * Note: skips `claim-code:` keys which share the `claim:` prefix in a broader
 * sense but are under a distinct `claim-code:` prefix. KV list with prefix
 * `claim:` (no trailing colon variation) will NOT match `claim-code:` keys.
 *
 * When forceResync is true, conflicts on btc_address upsert mutable columns
 * (status, reward_satoshis, reward_txid, display_name, tweet_url,
 * tweet_author, claimed_at) instead of being skipped. Use this to reconcile
 * D1 rows that were inserted before the per-write dual-write landed (KV
 * advanced status from "verified"→"rewarded" but D1 stayed at the older
 * value). Without forceResync the legacy DO NOTHING behavior is preserved
 * for cheap idempotent re-runs.
 */
async function backfillClaims(
  kv: KVNamespace,
  db: D1Database,
  batchSize: number,
  cursor: string | null,
  dryRun: boolean,
  forceResync: boolean
): Promise<AccumulatedCounts & { nextCursor: string | null }> {
  const counts: AccumulatedCounts = {
    inserted: 0,
    inserted_null_btcpubkey: 0,
    skipped_idempotent: 0,
    skipped_partial: 0,
    updated: 0,
    failed: [],
  };

  const listOpts: KVNamespaceListOptions = { prefix: "claim:", limit: batchSize };
  if (cursor) listOpts.cursor = cursor;

  const page = await kv.list(listOpts);

  for (const kvKey of page.keys) {
    // Explicitly skip claim-code: keys — they share the broader claim namespace
    // but are not ClaimRecord entries. KV prefix `claim:` won't match
    // `claim-code:` so this guard is belt-and-suspenders.
    if (kvKey.name.startsWith("claim-code:")) continue;

    const raw = await kv.get(kvKey.name);
    if (!raw) continue;

    let claim: ClaimRecord;
    try {
      claim = JSON.parse(raw) as ClaimRecord;
    } catch {
      counts.failed.push({ key: kvKey.name, reason: "JSON parse error" });
      continue;
    }

    // Validate status enum against D1 CHECK constraint
    const validStatuses = ["pending", "verified", "rewarded", "failed"] as const;
    if (!validStatuses.includes(claim.status as (typeof validStatuses)[number])) {
      counts.failed.push({
        key: kvKey.name,
        reason: `Invalid status value: "${claim.status}" — expected pending|verified|rewarded|failed`,
      });
      continue;
    }

    if (dryRun) {
      counts.inserted++;
      continue;
    }

    try {
      // ON CONFLICT branch differs by mode:
      //   default (forceResync=false) → DO NOTHING (legacy idempotent)
      //   force=resync                → DO UPDATE SET ... (reconcile stale rows)
      // We track inserts vs updates by reading meta.changes and probing the
      // pre-existing row only on conflict; doing a single statement keeps the
      // batch fast.
      const sql = forceResync
        ? `INSERT INTO claims (
             btc_address, display_name, tweet_url, tweet_author,
             claimed_at, reward_satoshis, reward_txid, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(btc_address) DO UPDATE SET
              display_name = excluded.display_name,
              tweet_url = excluded.tweet_url,
              tweet_author = excluded.tweet_author,
              claimed_at = excluded.claimed_at,
              reward_satoshis = excluded.reward_satoshis,
              reward_txid = excluded.reward_txid,
              status = excluded.status
            WHERE claims.status IS NOT excluded.status
               OR claims.reward_satoshis IS NOT excluded.reward_satoshis
               OR claims.reward_txid IS NOT excluded.reward_txid
               OR claims.display_name IS NOT excluded.display_name
               OR claims.tweet_url IS NOT excluded.tweet_url
               OR claims.tweet_author IS NOT excluded.tweet_author
               OR claims.claimed_at IS NOT excluded.claimed_at`
        : `INSERT INTO claims (
             btc_address, display_name, tweet_url, tweet_author,
             claimed_at, reward_satoshis, reward_txid, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(btc_address) DO NOTHING`;

      const result = await db
        .prepare(sql)
        .bind(
          claim.btcAddress,
          claim.displayName,
          claim.tweetUrl,
          claim.tweetAuthor ?? null,
          claim.claimedAt,
          claim.rewardSatoshis,
          claim.rewardTxid ?? null,
          claim.status
        )
        .run();

      if (result.meta.changes === 1) {
        // changes=1 in DO NOTHING mode → INSERT happened
        // changes=1 in DO UPDATE mode → either INSERT or UPDATE; probe to disambiguate
        if (forceResync) {
          // Cheap probe: meta.last_row_id is set only on INSERT (D1 SQLite
          // semantics); on UPDATE it's unchanged from the prior statement.
          // Rather than rely on that across drivers, do an explicit lookup
          // via meta.changes alone: in WHERE-guarded UPDATE we already know
          // changes=1 means a write happened, but to split insert vs update
          // we'd need a SELECT. To keep the batch fast we attribute all
          // change=1 in resync mode as `updated` UNLESS the row was newly
          // created — and detection of that requires an extra SELECT. We
          // accept conservative attribution: treat as `updated` in
          // forceResync mode. New rows in a resync pass should be rare
          // (they imply KV grew between backfill runs). If precise
          // discrimination becomes important, add a pre-SELECT.
          counts.updated = (counts.updated ?? 0) + 1;
        } else {
          counts.inserted++;
        }
      } else {
        // changes=0 → DO NOTHING fired (legacy mode) OR WHERE guard
        // suppressed UPDATE because all mutable columns already match
        // (resync mode, idempotent re-run).
        counts.skipped_idempotent++;
      }
    } catch (e) {
      counts.failed.push({
        key: kvKey.name,
        reason: `D1 insert error: ${(e as Error).message}`,
      });
    }
  }

  return {
    ...counts,
    nextCursor: page.list_complete ? null : (page.cursor ?? null),
  };
}

/**
 * Run inbox_messages backfill.
 *
 * Two passes in FK-safe order:
 *   Pass 1 (inbound): scan `inbox:message:` prefix — these are InboxMessage rows
 *   Pass 2 (replies): scan `inbox:reply:` prefix — these are OutboxReply rows
 *
 * FK ordering matters because reply rows have a reply_to_message_id FK pointing
 * to the parent message row. Inbound messages must be inserted first.
 *
 * Pagination via encoded cursor:
 *   - `inbound:<kv-cursor>` — still scanning inbound pass
 *   - `reply:<kv-cursor>`   — scanning reply pass (inbound complete)
 *   - null                  — both passes complete
 */
async function backfillInboxMessages(
  kv: KVNamespace,
  db: D1Database,
  batchSize: number,
  cursor: string | null,
  dryRun: boolean
): Promise<AccumulatedCounts & { nextCursor: string | null }> {
  const counts: AccumulatedCounts = {
    inserted: 0,
    inserted_null_btcpubkey: 0,
    skipped_idempotent: 0,
    skipped_partial: 0,
    failed: [],
  };

  // Decode cursor to determine which pass we're in
  let pass: "inbound" | "reply" = "inbound";
  let kvCursor: string | null = null;

  if (cursor) {
    if (cursor.startsWith("reply:")) {
      pass = "reply";
      kvCursor = cursor.slice("reply:".length) || null;
    } else if (cursor.startsWith("inbound:")) {
      pass = "inbound";
      kvCursor = cursor.slice("inbound:".length) || null;
    }
  }

  if (pass === "inbound") {
    const listOpts: KVNamespaceListOptions = {
      prefix: "inbox:message:",
      limit: batchSize,
    };
    if (kvCursor) listOpts.cursor = kvCursor;

    const page = await kv.list(listOpts);

    for (const kvKey of page.keys) {
      const raw = await kv.get(kvKey.name);
      if (!raw) continue;

      let msg: InboxMessage;
      try {
        msg = JSON.parse(raw) as InboxMessage;
      } catch {
        counts.failed.push({ key: kvKey.name, reason: "JSON parse error" });
        continue;
      }

      if (dryRun) {
        counts.inserted++;
        continue;
      }

      try {
        const result = await db
          .prepare(
            `INSERT INTO inbox_messages (
              message_id, is_reply, reply_to_message_id,
              from_stx_address, from_btc_address,
              to_btc_address, to_stx_address,
              content, payment_txid, payment_satoshis,
              payment_status, payment_terminal_reason,
              payment_error_code, payment_replacement_txid,
              payment_id, receipt_id,
              recovered_via_txid, authenticated,
              bitcoin_signature, sender_btc_address,
              sent_at, read_at, replied_at
            ) VALUES (
              ?, 0, ?,
              ?, NULL,
              ?, ?,
              ?, ?, ?,
              ?, NULL, NULL, NULL,
              ?, ?,
              ?, ?,
              ?, ?,
              ?, ?, ?
            ) ON CONFLICT(message_id) DO NOTHING`
          )
          .bind(
            msg.messageId,
            msg.replyTo ?? null,
            // from_stx_address = fromAddress (payer's STX address)
            msg.fromAddress,
            msg.toBtcAddress,
            msg.toStxAddress,
            msg.content,
            msg.paymentTxid ?? null,
            msg.paymentSatoshis ?? null,
            // payment_status: map RelayPaymentStatus to D1 enum; absent = null
            msg.paymentStatus ?? null,
            msg.paymentId ?? null,
            msg.receiptId ?? null,
            // recovered_via_txid: 0 = false, 1 = true
            msg.recoveredViaTxid ? 1 : 0,
            msg.authenticated ? 1 : 0,
            msg.senderSignature ?? null,
            msg.senderBtcAddress ?? null,
            msg.sentAt,
            msg.readAt ?? null,
            msg.repliedAt ?? null
          )
          .run();

        if (result.meta.changes === 1) {
          counts.inserted++;
        } else {
          counts.skipped_idempotent++;
        }
      } catch (e) {
        counts.failed.push({
          key: kvKey.name,
          reason: `D1 insert error: ${(e as Error).message}`,
        });
      }
    }

    if (!page.list_complete) {
      // More inbound messages to scan
      return {
        ...counts,
        nextCursor: `inbound:${page.cursor ?? ""}`,
      };
    }

    // Inbound complete — signal to start reply pass on next call
    return {
      ...counts,
      nextCursor: "reply:",
    };
  }

  // pass === "reply"
  const listOpts: KVNamespaceListOptions = {
    prefix: "inbox:reply:",
    limit: batchSize,
  };
  if (kvCursor) listOpts.cursor = kvCursor;

  const page = await kv.list(listOpts);

  for (const kvKey of page.keys) {
    const raw = await kv.get(kvKey.name);
    if (!raw) continue;

    let reply: OutboxReply;
    try {
      reply = JSON.parse(raw) as OutboxReply;
    } catch {
      counts.failed.push({ key: kvKey.name, reason: "JSON parse error" });
      continue;
    }

    if (dryRun) {
      counts.inserted++;
      continue;
    }

    // KV key is `inbox:reply:{messageId}` where messageId is the parent's ID.
    // The reply row's own message_id is synthesized via deriveReplyD1Id to avoid
    // PK collision with the parent inbound row (which uses messageId directly).
    // The reply_to_message_id FK column links back to the parent unchanged.
    const replyMessageId = deriveReplyD1Id(reply.messageId);

    const resolvedToBtcAddress = await resolveReplyRecipientBtcAddress(kv, reply.toBtcAddress);
    if (!resolvedToBtcAddress) {
      counts.failed.push({
        key: kvKey.name,
        reason: `Unable to resolve reply recipient BTC address from "${reply.toBtcAddress}"`,
      });
      continue;
    }

    try {
      const result = await db
        .prepare(
          `INSERT INTO inbox_messages (
            message_id, is_reply, reply_to_message_id,
            from_stx_address, from_btc_address,
            to_btc_address, to_stx_address,
            content, payment_txid, payment_satoshis,
            payment_status, payment_terminal_reason,
            payment_error_code, payment_replacement_txid,
            payment_id, receipt_id,
            recovered_via_txid, authenticated,
            bitcoin_signature, sender_btc_address,
            sent_at, read_at, replied_at
          ) VALUES (
            ?, 1, ?,
            NULL, ?,
            ?, NULL,
            ?, NULL, NULL,
            NULL, NULL, NULL, NULL,
            NULL, NULL,
            0, 0,
            ?, NULL,
            ?, NULL, NULL
          ) ON CONFLICT(message_id) DO NOTHING`
        )
        .bind(
          replyMessageId,
          // reply_to_message_id = the parent inbox message's ID
          reply.messageId,
          // from_btc_address = replier's BTC address
          reply.fromAddress,
          resolvedToBtcAddress,
          // content = reply text
          reply.reply,
          // bitcoin_signature = BIP-322 signature on the reply
          reply.signature,
          reply.repliedAt
        )
        .run();

      if (result.meta.changes === 1) {
        counts.inserted++;
      } else {
        counts.skipped_idempotent++;
      }
    } catch (e) {
      counts.failed.push({
        key: kvKey.name,
        reason: `D1 insert error: ${(e as Error).message}`,
      });
    }
  }

  return {
    ...counts,
    nextCursor: page.list_complete ? null : `reply:${page.cursor ?? ""}`,
  };
}

/**
 * Run vouches backfill: scan `vouch:` prefix, skip `vouch:index:` keys,
 * INSERT OR IGNORE into vouches.
 */
async function backfillVouches(
  kv: KVNamespace,
  db: D1Database,
  batchSize: number,
  cursor: string | null,
  dryRun: boolean
): Promise<AccumulatedCounts & { nextCursor: string | null }> {
  const counts: AccumulatedCounts = {
    inserted: 0,
    inserted_null_btcpubkey: 0,
    skipped_idempotent: 0,
    skipped_partial: 0,
    failed: [],
  };

  const listOpts: KVNamespaceListOptions = { prefix: "vouch:", limit: batchSize };
  if (cursor) listOpts.cursor = cursor;

  const page = await kv.list(listOpts);

  for (const kvKey of page.keys) {
    // Skip derived index entries — they are not VouchRecord rows
    if (kvKey.name.startsWith("vouch:index:")) continue;

    const raw = await kv.get(kvKey.name);
    if (!raw) continue;

    let vouch: VouchRecord;
    try {
      vouch = JSON.parse(raw) as VouchRecord;
    } catch {
      counts.failed.push({ key: kvKey.name, reason: "JSON parse error" });
      continue;
    }

    if (dryRun) {
      counts.inserted++;
      continue;
    }

    try {
      const result = await db
        .prepare(
          `INSERT INTO vouches (
            referrer_btc, referee_btc, registered_at, message_sent, paid_out
          ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(referrer_btc, referee_btc) DO NOTHING`
        )
        .bind(
          vouch.referrer,
          vouch.referee,
          vouch.registeredAt,
          vouch.messageSent ? 1 : 0,
          vouch.paidOut ? 1 : 0
        )
        .run();

      if (result.meta.changes === 1) {
        counts.inserted++;
      } else {
        counts.skipped_idempotent++;
      }
    } catch (e) {
      counts.failed.push({
        key: kvKey.name,
        reason: `D1 insert error: ${(e as Error).message}`,
      });
    }
  }

  return {
    ...counts,
    nextCursor: page.list_complete ? null : (page.cursor ?? null),
  };
}

// ── Route handlers ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/backfill
 *
 * Self-documenting route description. Requires X-Admin-Key.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return NextResponse.json({
    endpoint: "/api/admin/backfill",
    description:
      "Admin-gated KV → D1 backfill hydrator. Migrates agents, claims, inbox_messages, and vouches from VERIFIED_AGENTS KV into D1 using INSERT OR IGNORE for idempotent, resumable backfill.",
    authentication: "Requires X-Admin-Key header",
    methods: ["GET", "POST"],
    queryParams: {
      table: "Target table: agents | claims | inbox_messages | vouches | all (default: all). 'all' is one-shot (no cursor); use specific table for paginated resume.",
      batchSize: "KV scan page size: 10–500 (default: 100)",
      cursor: "Resume cursor from previous response. For inbox_messages: encoded as 'inbound:<kv-cursor>' or 'reply:<kv-cursor>'.",
      dryRun: "If 'true', counts rows without writing to D1 or KV. Default: false.",
      force: "Claims table only. 'resync' upgrades the conflict clause from DO NOTHING to DO UPDATE, reconciling existing D1 rows whose status/reward fields lag KV. Default: legacy INSERT OR IGNORE semantics. Ignored for non-claims tables.",
    },
    warning:
      "table=all is one-shot with no cursor; use per-table + cursor loop for large datasets to avoid request timeout.",
    response: {
      table: "Table targeted",
      dryRun: "Whether this was a dry run",
      batchSize: "Effective batch size used",
      inserted: "Rows newly inserted",
      inserted_null_btcpubkey: "Subset of inserted with btc_public_key = NULL (BIP-322 bc1q agents; expected ~708 on first full backfill)",
      skipped_idempotent: "Rows skipped due to existing D1 row (INSERT OR IGNORE) or unchanged mutable columns under force=resync",
      skipped_partial: "PartialAgentRecord rows skipped (agents table only)",
      updated: "Claims-only, present under force=resync. Existing D1 rows whose mutable columns (status, reward_satoshis, reward_txid, display_name, tweet_url, tweet_author, claimed_at) were reconciled from KV.",
      failed: "Array of { key, reason } for rows that errored (missing verifiedAt or D1 error)",
      cursor: "Opaque resume cursor; null when scan complete",
      duration_ms: "Wall-clock milliseconds for this request",
    },
    operationalPlan: {
      step1: "POST ?table=all&dryRun=true — verify counts without writing",
      step2: "POST ?table=agents — run until cursor is null",
      step3: "POST ?table=claims — run until cursor is null",
      step4: "POST ?table=inbox_messages — run until cursor is null (uses inbound:/reply: cursor prefix)",
      step5: "POST ?table=vouches — run until cursor is null",
    },
  });
}

/**
 * POST /api/admin/backfill
 *
 * Run a batch of KV → D1 backfill. Paginated and resumable via cursor.
 *
 * Query params:
 *   - table: agents | claims | inbox_messages | vouches | all (default: all)
 *   - batchSize: 10–500 (default: 100)
 *   - cursor: resume token from prior response
 *   - dryRun: true | false (default: false)
 *
 * table=all runs agents → claims → inbox_messages → vouches in one shot.
 * Use specific table names for paginated resume with cursor support.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const start = Date.now();

  const { env, ctx } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const db = env.DB as D1Database;
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();

  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/admin/backfill" })
    : createConsoleLogger({ rayId, path: "/api/admin/backfill" });

  const { searchParams } = new URL(request.url);
  const rawTable = searchParams.get("table") ?? "all";
  const batchSize = parseBatchSize(searchParams.get("batchSize"));
  const cursor = searchParams.get("cursor") ?? null;
  const dryRun = searchParams.get("dryRun") === "true";
  // claims-only: when "resync", existing D1 rows are upserted from KV
  // (display_name, tweet_url, tweet_author, claimed_at, reward_satoshis,
  // reward_txid, status). Default behavior (force=null) preserves the
  // legacy INSERT OR IGNORE semantics. Ignored for non-claims tables.
  const forceResync = searchParams.get("force") === "resync";

  const validTables: TableTarget[] = ["agents", "claims", "inbox_messages", "vouches", "all"];
  if (!validTables.includes(rawTable as TableTarget)) {
    return NextResponse.json(
      { error: `Invalid table "${rawTable}". Must be one of: ${validTables.join(", ")}` },
      { status: 400 }
    );
  }
  const table = rawTable as TableTarget;

  logger.info("backfill.start", { table, batchSize, dryRun });

  try {
    // ── table=all: one-shot, no cursor support ──────────────────────────────
    if (table === "all") {
      const totals: AccumulatedCounts = {
        inserted: 0,
        inserted_null_btcpubkey: 0,
        skipped_idempotent: 0,
        skipped_partial: 0,
        failed: [],
      };

      // Agents (paginate internally until complete)
      let agentCursor: string | null = null;
      do {
        const res = await backfillAgents(kv, db, batchSize, agentCursor, dryRun);
        totals.inserted += res.inserted;
        totals.inserted_null_btcpubkey += res.inserted_null_btcpubkey;
        totals.skipped_idempotent += res.skipped_idempotent;
        totals.skipped_partial += res.skipped_partial;
        totals.failed.push(...res.failed);
        agentCursor = res.nextCursor;
        logger.info("backfill.batch", {
          table: "agents",
          inserted_so_far: totals.inserted,
          inserted_null_btcpubkey_so_far: totals.inserted_null_btcpubkey,
          scanned_so_far: totals.inserted + totals.skipped_idempotent + totals.skipped_partial + totals.failed.length,
          cursor: agentCursor,
        });
      } while (agentCursor !== null);

      // Claims
      let claimCursor: string | null = null;
      do {
        const res = await backfillClaims(kv, db, batchSize, claimCursor, dryRun, forceResync);
        totals.inserted += res.inserted;
        totals.skipped_idempotent += res.skipped_idempotent;
        totals.updated = (totals.updated ?? 0) + (res.updated ?? 0);
        totals.failed.push(...res.failed);
        claimCursor = res.nextCursor;
        logger.info("backfill.batch", {
          table: "claims",
          inserted_so_far: totals.inserted,
          scanned_so_far: totals.inserted + totals.skipped_idempotent + totals.failed.length,
          cursor: claimCursor,
        });
      } while (claimCursor !== null);

      // Inbox messages (inbound first, then replies — FK order)
      let inboxCursor: string | null = null;
      do {
        const res = await backfillInboxMessages(kv, db, batchSize, inboxCursor, dryRun);
        totals.inserted += res.inserted;
        totals.skipped_idempotent += res.skipped_idempotent;
        totals.failed.push(...res.failed);
        inboxCursor = res.nextCursor;
        logger.info("backfill.batch", {
          table: "inbox_messages",
          inserted_so_far: totals.inserted,
          scanned_so_far: totals.inserted + totals.skipped_idempotent + totals.failed.length,
          cursor: inboxCursor,
        });
      } while (inboxCursor !== null);

      // Vouches
      let vouchCursor: string | null = null;
      do {
        const res = await backfillVouches(kv, db, batchSize, vouchCursor, dryRun);
        totals.inserted += res.inserted;
        totals.skipped_idempotent += res.skipped_idempotent;
        totals.failed.push(...res.failed);
        vouchCursor = res.nextCursor;
        logger.info("backfill.batch", {
          table: "vouches",
          inserted_so_far: totals.inserted,
          scanned_so_far: totals.inserted + totals.skipped_idempotent + totals.failed.length,
          cursor: vouchCursor,
        });
      } while (vouchCursor !== null);

      const duration_ms = Date.now() - start;
      logger.info("backfill.complete", {
        table: "all",
        inserted: totals.inserted,
        inserted_null_btcpubkey: totals.inserted_null_btcpubkey,
        skipped_idempotent: totals.skipped_idempotent,
        skipped_partial: totals.skipped_partial,
        failed_count: totals.failed.length,
        duration_ms,
      });

      const result: BackfillResult = {
        table: "all",
        dryRun,
        batchSize,
        inserted: totals.inserted,
        inserted_null_btcpubkey: totals.inserted_null_btcpubkey,
        skipped_idempotent: totals.skipped_idempotent,
        skipped_partial: totals.skipped_partial,
        ...(totals.updated !== undefined ? { updated: totals.updated } : {}),
        failed: totals.failed,
        cursor: null,
        duration_ms,
      };
      return NextResponse.json(result);
    }

    // ── Specific table: paginated with cursor support ───────────────────────
    let res: AccumulatedCounts & { nextCursor: string | null };

    switch (table) {
      case "agents":
        res = await backfillAgents(kv, db, batchSize, cursor, dryRun);
        break;
      case "claims":
        res = await backfillClaims(kv, db, batchSize, cursor, dryRun, forceResync);
        break;
      case "inbox_messages":
        res = await backfillInboxMessages(kv, db, batchSize, cursor, dryRun);
        break;
      case "vouches":
        res = await backfillVouches(kv, db, batchSize, cursor, dryRun);
        break;
      default:
        // Unreachable due to earlier validation, but satisfies TypeScript exhaustiveness
        return NextResponse.json({ error: "Unexpected table value" }, { status: 400 });
    }

    const duration_ms = Date.now() - start;

    logger.info("backfill.batch", {
      table,
      inserted_so_far: res.inserted,
      inserted_null_btcpubkey_so_far: res.inserted_null_btcpubkey,
      scanned_so_far:
        res.inserted +
        res.skipped_idempotent +
        res.skipped_partial +
        res.failed.length,
      cursor: res.nextCursor,
    });

    if (res.nextCursor === null) {
      logger.info("backfill.complete", {
        table,
        inserted: res.inserted,
        inserted_null_btcpubkey: res.inserted_null_btcpubkey,
        skipped_idempotent: res.skipped_idempotent,
        skipped_partial: res.skipped_partial,
        failed_count: res.failed.length,
        duration_ms,
      });
    }

    for (const failure of res.failed) {
      logger.warn("backfill.error", { table, key: failure.key, reason: failure.reason });
    }

    const result: BackfillResult = {
      table,
      dryRun,
      batchSize,
      inserted: res.inserted,
      inserted_null_btcpubkey: res.inserted_null_btcpubkey,
      skipped_idempotent: res.skipped_idempotent,
      skipped_partial: res.skipped_partial,
      ...(res.updated !== undefined ? { updated: res.updated } : {}),
      failed: res.failed,
      cursor: res.nextCursor,
      duration_ms,
    };
    return NextResponse.json(result);
  } catch (e) {
    const duration_ms = Date.now() - start;
    logger.warn("backfill.error", {
      table,
      key: "route-level",
      reason: (e as Error).message,
    });
    return NextResponse.json(
      {
        error: `Backfill failed: ${(e as Error).message}`,
        table,
        duration_ms,
      },
      { status: 500 }
    );
  }
}
