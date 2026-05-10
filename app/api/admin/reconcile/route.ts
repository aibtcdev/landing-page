import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { isPartialAgentRecord } from "@/lib/types";
import type { AgentRecord } from "@/lib/types";
import type { InboxAgentIndex } from "@/lib/inbox/types";
import { REPLY_D1_PK_PREFIX } from "@/lib/inbox/constants";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  computeDrift,
  computeAgentsDrift,
  type TableTarget,
  type TableReconcileResult,
  type FieldDiff,
  type UnreadCountDriftEntry,
  type AcceptanceTestResults,
} from "@/lib/d1/reconcile";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Clamp sampleSize to [0, 500], default 50.
 * sampleSize=0 skips field-level spot-checks entirely (count-only reconciliation).
 */
function parseSampleSize(raw: string | null): number {
  if (!raw) return 50;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(500, n));
}

/**
 * Count all KV keys with the given prefix via paginated list().
 * Returns { total, partial } where partial is the count of PartialAgentRecord
 * entries (only non-zero for the agents table).
 */
async function countKvKeys(
  kv: KVNamespace,
  prefix: string,
  countPartials = false,
  skipPrefixes: string[] = []
): Promise<{ total: number; partial: number }> {
  let total = 0;
  let partial = 0;
  let cursor: string | undefined = undefined;

  do {
    const opts: KVNamespaceListOptions = { prefix, limit: 1000 };
    if (cursor) opts.cursor = cursor;

    const page = await kv.list(opts);

    for (const key of page.keys) {
      if (skipPrefixes.some((p) => key.name.startsWith(p))) continue;
      total++;

      if (countPartials) {
        const raw = await kv.get(key.name);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (isPartialAgentRecord(parsed)) partial++;
          } catch {
            // malformed — count as full for conservatism
          }
        }
      }
    }

    cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
  } while (cursor !== undefined);

  return { total, partial };
}

/**
 * Sample up to `n` random KV keys from those with `prefix`.
 * Returns a shuffled subset of the keys (not the values).
 * Skips keys starting with any of `skipPrefixes`.
 */
async function sampleKvKeys(
  kv: KVNamespace,
  prefix: string,
  n: number,
  skipPrefixes: string[] = []
): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined = undefined;

  do {
    const opts: KVNamespaceListOptions = { prefix, limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const page = await kv.list(opts);
    for (const key of page.keys) {
      if (skipPrefixes.some((p) => key.name.startsWith(p))) continue;
      keys.push(key.name);
    }
    cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
  } while (cursor !== undefined);

  // Fisher-Yates shuffle for fair random sample
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }

  return keys.slice(0, n);
}

/**
 * Single-pass scan of `btc:` KV prefix — returns the set of btcAddress values
 * whose agent record is NOT PartialAgentRecord. Used by claims/inbox/vouches
 * to compute drift_explained from KV truth (not D1 absence).
 *
 * Reads values in parallel batches of 50 to keep wall-clock manageable.
 */
async function buildFullAgentSet(kv: KVNamespace): Promise<Set<string>> {
  const fullAgents = new Set<string>();
  let cursor: string | undefined = undefined;

  do {
    const opts: KVNamespaceListOptions = { prefix: "btc:", limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const page = await kv.list(opts);

    // Fetch values in parallel batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < page.keys.length; i += BATCH_SIZE) {
      const batch = page.keys.slice(i, i + BATCH_SIZE);
      const values = await Promise.all(batch.map((k) => kv.get(k.name)));
      for (let j = 0; j < batch.length; j++) {
        const raw = values[j];
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (!isPartialAgentRecord(parsed)) {
            // Strip the "btc:" prefix to get the btcAddress
            fullAgents.add(batch[j].name.slice("btc:".length));
          }
        } catch {
          // malformed — skip
        }
      }
    }

    cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
  } while (cursor !== undefined);

  return fullAgents;
}

// ── Per-table reconciliation ───────────────────────────────────────────────

/**
 * Reconcile the agents table.
 *
 * Count check: scan btc: prefix; exclude PartialAgentRecord entries from
 * kv_count. D1 agent count must equal KV full-agent count.
 *
 * Field-level spot-check: for sampled full agents, compare a subset of
 * critical D1 columns to the KV record.
 */
async function reconcileAgents(
  kv: KVNamespace,
  db: D1Database,
  sampleSize: number
): Promise<Omit<TableReconcileResult, "duration_ms">> {
  // Count KV agents; scan values to identify partials
  const { total: kv_total, partial: kv_partial } = await countKvKeys(
    kv,
    "btc:",
    true // read values to detect partials
  );

  // D1 count
  const d1Row = await db.prepare("SELECT COUNT(*) AS cnt FROM agents").first<{ cnt: number }>();
  const d1_count = d1Row?.cnt ?? 0;

  const breakdown = computeAgentsDrift(kv_total, kv_partial, d1_count);

  // Field-level spot-check — only on full agents; skip entirely when sampleSize=0
  const sampledKeys = sampleSize > 0 ? await sampleKvKeys(kv, "btc:", sampleSize * 3) : []; // oversample to account for partials
  const field_diffs: FieldDiff[] = [];
  let checked = 0;

  for (const key of sampledKeys) {
    if (checked >= sampleSize) break;

    const raw = await kv.get(key);
    if (!raw) continue;

    let agent: unknown;
    try {
      agent = JSON.parse(raw);
    } catch {
      continue;
    }

    // Skip partials in spot-check — they are intentionally absent from D1
    if (isPartialAgentRecord(agent)) continue;

    const rec = agent as AgentRecord;
    checked++;

    const d1Agent = await db
      .prepare(
        "SELECT btc_address, stx_address, stx_public_key, btc_public_key, verified_at FROM agents WHERE btc_address = ?"
      )
      .bind(rec.btcAddress)
      .first<{
        btc_address: string;
        stx_address: string;
        stx_public_key: string;
        btc_public_key: string;
        verified_at: string;
      }>();

    if (!d1Agent) {
      field_diffs.push({
        key,
        field: "_row_missing",
        kv_value: rec.btcAddress,
        d1_value: null,
      });
      continue;
    }

    // Compare critical fields
    const checks: Array<[string, unknown, unknown]> = [
      ["stx_address", rec.stxAddress, d1Agent.stx_address],
      ["stx_public_key", rec.stxPublicKey, d1Agent.stx_public_key],
      ["btc_public_key", rec.btcPublicKey, d1Agent.btc_public_key],
      ["verified_at", rec.verifiedAt, d1Agent.verified_at],
    ];

    for (const [field, kv_value, d1_value] of checks) {
      if (kv_value !== d1_value) {
        field_diffs.push({ key, field, kv_value, d1_value });
      }
    }
  }

  return {
    table: "agents",
    kv_count: breakdown.kv_count_full,
    kv_count_partial_excluded: kv_partial,
    d1_count: breakdown.d1_count,
    drift: breakdown.drift,
    drift_explained: breakdown.drift_explained,
    drift_unexplained: breakdown.drift_unexplained,
    sample_size: checked,
    field_diffs,
  };
}

/**
 * Reconcile the claims table.
 *
 * Drift is explained by claims whose FK parent agent is absent from the full-agent
 * set (i.e., the agent is a PartialAgentRecord not in D1). Uses KV-truth via
 * buildFullAgentSet rather than D1 SELECT — backfill failures no longer look explained.
 */
async function reconcileClaims(
  kv: KVNamespace,
  db: D1Database,
  sampleSize: number,
  fullAgents: Set<string>
): Promise<Omit<TableReconcileResult, "duration_ms">> {
  // Count KV claim keys (claim: prefix, no claim-code: entries)
  const { total: kv_total } = await countKvKeys(kv, "claim:", false, ["claim-code:"]);

  const d1Row = await db.prepare("SELECT COUNT(*) AS cnt FROM claims").first<{ cnt: number }>();
  const d1_count = d1Row?.cnt ?? 0;

  // Determine drift_explained: scan claim keys using KV-truth (fullAgents set)
  let drift_explained = 0;
  {
    let cursor: string | undefined = undefined;
    do {
      const opts: KVNamespaceListOptions = { prefix: "claim:", limit: 1000 };
      if (cursor) opts.cursor = cursor;
      const page = await kv.list(opts);
      for (const key of page.keys) {
        if (key.name.startsWith("claim-code:")) continue;
        const btcAddress = key.name.slice("claim:".length);
        if (!fullAgents.has(btcAddress)) drift_explained++;
      }
      cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
    } while (cursor !== undefined);
  }

  const breakdown = computeDrift(kv_total, 0, d1_count, drift_explained, {
    partial_cascade: drift_explained,
  });

  // Field-level spot-check; skipped when sampleSize=0
  const sampledKeys = sampleSize > 0 ? await sampleKvKeys(kv, "claim:", sampleSize, ["claim-code:"]) : [];
  const field_diffs: FieldDiff[] = [];
  let checked = 0;

  for (const key of sampledKeys) {
    if (checked >= sampleSize) break;
    const raw = await kv.get(key);
    if (!raw) continue;

    let claim: Record<string, unknown>;
    try {
      claim = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    checked++;
    const btcAddress = claim.btcAddress as string;

    const d1Claim = await db
      .prepare("SELECT btc_address, status, claimed_at FROM claims WHERE btc_address = ?")
      .bind(btcAddress)
      .first<{ btc_address: string; status: string; claimed_at: string }>();

    if (!d1Claim) {
      field_diffs.push({ key, field: "_row_missing", kv_value: btcAddress, d1_value: null });
      continue;
    }

    if (claim.status !== d1Claim.status) {
      field_diffs.push({ key, field: "status", kv_value: claim.status, d1_value: d1Claim.status });
    }
    if (claim.claimedAt !== d1Claim.claimed_at) {
      field_diffs.push({ key, field: "claimed_at", kv_value: claim.claimedAt, d1_value: d1Claim.claimed_at });
    }
  }

  return {
    table: "claims",
    kv_count: breakdown.kv_count_full,
    kv_count_partial_excluded: 0,
    d1_count: breakdown.d1_count,
    drift: breakdown.drift,
    drift_explained: breakdown.drift_explained,
    drift_unexplained: breakdown.drift_unexplained,
    explained_categories: breakdown.explained_categories,
    sample_size: checked,
    field_diffs,
  };
}

/**
 * Reconcile the inbox_messages table.
 *
 * KV has two sub-prefixes: inbox:message: (inbound) and inbox:reply: (replies).
 * Both are folded into a single inbox_messages D1 table.
 * Drift explained via KV-truth: partial_cascade (recipient not a full agent),
 * unique_payment_txid_replay (duplicate payment txids), and unresolvable_stx_reply
 * (reply whose STX replyTo cannot be resolved to a full agent).
 *
 * Reply rows in D1 have message_id prefixed with REPLY_D1_PK_PREFIX.
 */
async function reconcileInboxMessages(
  kv: KVNamespace,
  db: D1Database,
  sampleSize: number,
  fullAgents: Set<string>
): Promise<Omit<TableReconcileResult, "duration_ms">> {
  // Single-pass: collect all parsed inbox records to derive all category counts
  type ParsedMsg = { type: "message"; toBtcAddress?: string; paymentTxid?: string };
  type ParsedReply = { type: "reply"; replyTo?: string; messageId?: string };
  const allRecords: Array<ParsedMsg | ParsedReply> = [];

  // Scan inbox:message: prefix
  let kv_inbound = 0;
  {
    let cursor: string | undefined = undefined;
    do {
      const opts: KVNamespaceListOptions = { prefix: "inbox:message:", limit: 500 };
      if (cursor) opts.cursor = cursor;
      const page = await kv.list(opts);
      kv_inbound += page.keys.length;
      for (const key of page.keys) {
        const raw = await kv.get(key.name);
        if (!raw) continue;
        try {
          const msg = JSON.parse(raw) as Record<string, unknown>;
          allRecords.push({
            type: "message",
            toBtcAddress: msg.toBtcAddress as string | undefined,
            paymentTxid: msg.paymentTxid as string | undefined,
          });
        } catch {
          // ignore malformed
        }
      }
      cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
    } while (cursor !== undefined);
  }

  // Scan inbox:reply: prefix
  let kv_reply = 0;
  {
    let cursor: string | undefined = undefined;
    do {
      const opts: KVNamespaceListOptions = { prefix: "inbox:reply:", limit: 500 };
      if (cursor) opts.cursor = cursor;
      const page = await kv.list(opts);
      kv_reply += page.keys.length;
      for (const key of page.keys) {
        const raw = await kv.get(key.name);
        if (!raw) continue;
        try {
          const reply = JSON.parse(raw) as Record<string, unknown>;
          allRecords.push({
            type: "reply",
            replyTo: reply.replyTo as string | undefined,
            messageId: reply.messageId as string | undefined,
          });
        } catch {
          // ignore malformed
        }
      }
      cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
    } while (cursor !== undefined);
  }

  const kv_total = kv_inbound + kv_reply;

  const d1Row = await db
    .prepare("SELECT COUNT(*) AS cnt FROM inbox_messages")
    .first<{ cnt: number }>();
  const d1_count = d1Row?.cnt ?? 0;

  // Derive explained categories from the single-pass records
  let partial_cascade = 0;
  let unresolvable_stx_reply = 0;
  const txidCounts = new Map<string, number>();

  for (const rec of allRecords) {
    if (rec.type === "message") {
      const { toBtcAddress, paymentTxid } = rec;
      if (toBtcAddress && !fullAgents.has(toBtcAddress)) {
        partial_cascade++;
      }
      if (paymentTxid) {
        txidCounts.set(paymentTxid, (txidCounts.get(paymentTxid) ?? 0) + 1);
      }
    } else {
      // reply record
      const { replyTo } = rec;
      if (replyTo && (replyTo.startsWith("SP") || replyTo.startsWith("ST"))) {
        // Stacks address shape — look up stx: KV key to resolve to btcAddress
        const stxRaw = await kv.get(`stx:${replyTo}`);
        if (!stxRaw) {
          unresolvable_stx_reply++;
        } else {
          try {
            const stxRecord = JSON.parse(stxRaw) as Record<string, unknown>;
            const resolvedBtc = stxRecord.btcAddress as string | undefined;
            if (!resolvedBtc || !fullAgents.has(resolvedBtc)) {
              partial_cascade++;
            }
          } catch {
            unresolvable_stx_reply++;
          }
        }
      }
    }
  }

  // unique_payment_txid_replay: sum of (count - 1) for all txids seen more than once
  let unique_payment_txid_replay = 0;
  for (const count of txidCounts.values()) {
    if (count > 1) unique_payment_txid_replay += count - 1;
  }

  const drift_explained = partial_cascade + unique_payment_txid_replay + unresolvable_stx_reply;
  const breakdown = computeDrift(kv_total, 0, d1_count, drift_explained, {
    partial_cascade,
    unique_payment_txid_replay,
    unresolvable_stx_reply,
  });

  // Field-level spot-check on inbound messages only; skipped when sampleSize=0
  const sampleInbound = sampleSize > 0 ? Math.ceil(sampleSize * 0.7) : 0;
  const sampleReply = sampleSize > 0 ? sampleSize - sampleInbound : 0;
  const inboundKeys = sampleSize > 0 ? await sampleKvKeys(kv, "inbox:message:", sampleInbound) : [];
  const replyKeys = sampleSize > 0 ? await sampleKvKeys(kv, "inbox:reply:", sampleReply) : [];
  const field_diffs: FieldDiff[] = [];
  let checked = 0;

  for (const key of inboundKeys) {
    const raw = await kv.get(key);
    if (!raw) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    checked++;
    const messageId = msg.messageId as string;

    const d1Msg = await db
      .prepare("SELECT message_id, to_btc_address, sent_at FROM inbox_messages WHERE message_id = ?")
      .bind(messageId)
      .first<{ message_id: string; to_btc_address: string; sent_at: string }>();

    if (!d1Msg) {
      field_diffs.push({ key, field: "_row_missing", kv_value: messageId, d1_value: null });
      continue;
    }
    if (msg.toBtcAddress !== d1Msg.to_btc_address) {
      field_diffs.push({ key, field: "to_btc_address", kv_value: msg.toBtcAddress, d1_value: d1Msg.to_btc_address });
    }
    if (msg.sentAt !== d1Msg.sent_at) {
      field_diffs.push({ key, field: "sent_at", kv_value: msg.sentAt, d1_value: d1Msg.sent_at });
    }
  }

  for (const key of replyKeys) {
    const raw = await kv.get(key);
    if (!raw) continue;
    let reply: Record<string, unknown>;
    try {
      reply = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    checked++;
    const parentId = reply.messageId as string;
    const replyMessageId = `${REPLY_D1_PK_PREFIX}${parentId}`;

    const d1Reply = await db
      .prepare("SELECT message_id, reply_to_message_id FROM inbox_messages WHERE message_id = ?")
      .bind(replyMessageId)
      .first<{ message_id: string; reply_to_message_id: string }>();

    if (!d1Reply) {
      field_diffs.push({ key, field: "_row_missing", kv_value: replyMessageId, d1_value: null });
    }
  }

  return {
    table: "inbox_messages",
    kv_count: breakdown.kv_count_full,
    kv_count_partial_excluded: 0,
    d1_count: breakdown.d1_count,
    drift: breakdown.drift,
    drift_explained: breakdown.drift_explained,
    drift_unexplained: breakdown.drift_unexplained,
    explained_categories: breakdown.explained_categories,
    sample_size: checked,
    field_diffs,
  };
}

/**
 * Reconcile the vouches table.
 *
 * Drift is explained by vouch records where either the referrer or referee
 * is absent from the full-agent set (i.e., a PartialAgentRecord). Uses KV-truth
 * via fullAgents rather than D1 SELECT — one explained row regardless of which side missed.
 */
async function reconcileVouches(
  kv: KVNamespace,
  db: D1Database,
  sampleSize: number,
  fullAgents: Set<string>
): Promise<Omit<TableReconcileResult, "duration_ms">> {
  const { total: kv_total } = await countKvKeys(kv, "vouch:", false, ["vouch:index:"]);

  const d1Row = await db.prepare("SELECT COUNT(*) AS cnt FROM vouches").first<{ cnt: number }>();
  const d1_count = d1Row?.cnt ?? 0;

  // drift_explained: vouch rows with Partial referrer or referee (KV-truth)
  let drift_explained = 0;
  {
    let cursor: string | undefined = undefined;
    do {
      const opts: KVNamespaceListOptions = { prefix: "vouch:", limit: 1000 };
      if (cursor) opts.cursor = cursor;
      const page = await kv.list(opts);
      for (const key of page.keys) {
        if (key.name.startsWith("vouch:index:")) continue;
        const raw = await kv.get(key.name);
        if (!raw) continue;
        try {
          const vouch = JSON.parse(raw) as Record<string, unknown>;
          const referrer = vouch.referrer as string | undefined;
          const referee = vouch.referee as string | undefined;
          if (referrer && referee) {
            if (!fullAgents.has(referrer) || !fullAgents.has(referee)) drift_explained++;
          }
        } catch {
          // ignore
        }
      }
      cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
    } while (cursor !== undefined);
  }

  const breakdown = computeDrift(kv_total, 0, d1_count, drift_explained, {
    partial_cascade: drift_explained,
  });

  // Field-level spot-check; skipped when sampleSize=0
  const sampledKeys = sampleSize > 0 ? await sampleKvKeys(kv, "vouch:", sampleSize, ["vouch:index:"]) : [];
  const field_diffs: FieldDiff[] = [];
  let checked = 0;

  for (const key of sampledKeys) {
    if (checked >= sampleSize) break;
    const raw = await kv.get(key);
    if (!raw) continue;
    let vouch: Record<string, unknown>;
    try {
      vouch = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    checked++;
    const referrer = vouch.referrer as string;
    const referee = vouch.referee as string;

    const d1Vouch = await db
      .prepare("SELECT referrer_btc, referee_btc, registered_at FROM vouches WHERE referrer_btc = ? AND referee_btc = ?")
      .bind(referrer, referee)
      .first<{ referrer_btc: string; referee_btc: string; registered_at: string }>();

    if (!d1Vouch) {
      field_diffs.push({
        key,
        field: "_row_missing",
        kv_value: `${referrer}:${referee}`,
        d1_value: null,
      });
      continue;
    }
    if (vouch.registeredAt !== d1Vouch.registered_at) {
      field_diffs.push({ key, field: "registered_at", kv_value: vouch.registeredAt, d1_value: d1Vouch.registered_at });
    }
  }

  return {
    table: "vouches",
    kv_count: breakdown.kv_count_full,
    kv_count_partial_excluded: 0,
    d1_count: breakdown.d1_count,
    drift: breakdown.drift,
    drift_explained: breakdown.drift_explained,
    drift_unexplained: breakdown.drift_unexplained,
    explained_categories: breakdown.explained_categories,
    sample_size: checked,
    field_diffs,
  };
}

/**
 * Run the unreadCount acceptance test.
 *
 * For each BTC address with a non-zero cached unreadCount in KV's
 * inbox:agent:{btc} index, compare to a live D1 count of unread inbound
 * messages. Includes the regression-test address from RFC §6.
 *
 * The KV `unreadCount` field is set during message delivery and decremented
 * on mark-read. D1 recomputes it via SELECT COUNT(*) — discrepancy indicates
 * the drift bug tracked in aibtc-mcp-server#497. Phase 2.5 resolves it by
 * switching reads to D1's live count; this test surfaces the delta.
 */
async function runUnreadCountAcceptanceTest(
  kv: KVNamespace,
  db: D1Database,
  minAddresses = 3
): Promise<AcceptanceTestResults> {
  // Regression-test address from RFC §6 — must always be included if present in KV
  const RFC_REGRESSION_ADDRESS = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";

  const candidates: Array<{ address: string; kv_cached: number }> = [];

  // Scan inbox:agent: prefix to find addresses with non-zero unreadCount
  let cursor: string | undefined = undefined;
  do {
    const opts: KVNamespaceListOptions = { prefix: "inbox:agent:", limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const page = await kv.list(opts);

    for (const key of page.keys) {
      const btcAddress = key.name.slice("inbox:agent:".length);
      const raw = await kv.get(key.name);
      if (!raw) continue;
      try {
        const index = JSON.parse(raw) as Partial<InboxAgentIndex>;
        const unread = index.unreadCount ?? 0;
        if (unread > 0 || btcAddress === RFC_REGRESSION_ADDRESS) {
          candidates.push({ address: btcAddress, kv_cached: unread });
        }
      } catch {
        // skip malformed
      }
    }
    cursor = page.list_complete ? undefined : (page.cursor ?? undefined);
  } while (cursor !== undefined);

  // Ensure RFC regression address is included even if not in KV
  if (!candidates.some((c) => c.address === RFC_REGRESSION_ADDRESS)) {
    const raw = await kv.get(`inbox:agent:${RFC_REGRESSION_ADDRESS}`);
    if (raw) {
      try {
        const index = JSON.parse(raw) as Partial<InboxAgentIndex>;
        candidates.push({ address: RFC_REGRESSION_ADDRESS, kv_cached: index.unreadCount ?? 0 });
      } catch {
        candidates.push({ address: RFC_REGRESSION_ADDRESS, kv_cached: 0 });
      }
    }
  }

  // Take up to minAddresses + a buffer sample; prioritize regression address
  const regressionEntry = candidates.find((c) => c.address === RFC_REGRESSION_ADDRESS);
  const others = candidates.filter((c) => c.address !== RFC_REGRESSION_ADDRESS);
  const selected = [
    ...(regressionEntry ? [regressionEntry] : []),
    ...others.slice(0, Math.max(0, minAddresses - (regressionEntry ? 1 : 0))),
  ];

  const entries: UnreadCountDriftEntry[] = await Promise.all(
    selected.map(async ({ address, kv_cached }) => {
      const d1Row = await db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM inbox_messages
           WHERE to_btc_address = ?
             AND is_reply = 0
             AND read_at IS NULL`
        )
        .bind(address)
        .first<{ cnt: number }>();
      const d1_count = d1Row?.cnt ?? 0;
      return { address, kv_cached, d1_count, drift: kv_cached - d1_count };
    })
  );

  return {
    unread_count_drift: entries,
    passed: entries.every((e) => e.drift === 0),
  };
}

// ── Full reconcile response shape ──────────────────────────────────────────

interface ReconcileResponse extends TableReconcileResult {
  acceptance_tests?: AcceptanceTestResults;
}

interface ReconcileAllResponse {
  tables: ReconcileResponse[];
  total_drift_unexplained: number;
  acceptance_tests?: AcceptanceTestResults;
  duration_ms: number;
}

// ── Route handlers ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/reconcile
 *
 * Self-documenting route description. Requires X-Admin-Key.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return NextResponse.json({
    endpoint: "/api/admin/reconcile",
    description:
      "Admin-gated KV ↔ D1 reconciliation. Compares row counts and spot-checks field-level integrity for all 4 D1 tables. Surfaces drift breakdown (explained vs. unexplained) and runs unreadCount acceptance test. Zero unexplained drift gates Phase 2.x read flips.",
    authentication: "Requires X-Admin-Key header",
    methods: ["GET", "POST"],
    queryParams: {
      table: "Target table: agents | claims | inbox_messages | vouches | all (default: all)",
      sampleSize: "Field-level spot-check sample size: 1–500 (default: 50)",
      acceptanceTests:
        "Pass 'unreadCount' to include unread count acceptance test (default: included for inbox_messages and all)",
    },
    baseline: {
      note: "Phase 1.3 operational backfill (2026-05-09T23:55Z) produced these drift numbers:",
      agents: { d1: 243, kv_partial: 1421, drift_explained: 1421 },
      claims: { d1: 123, kv_cascade: 454, drift_explained: 454 },
      inbox_messages: { d1: 5223, kv_cascade: 2540, drift_explained: 2540 },
      vouches: { d1: 30, kv_cascade: 65, drift_explained: 65 },
    },
    response: {
      kv_count: "KV keys scanned (excluding Partial for agents)",
      kv_count_partial_excluded: "PartialAgentRecord entries excluded (agents only)",
      d1_count: "D1 SELECT COUNT(*) result",
      drift: "kv_count - d1_count",
      drift_explained: "Rows whose absence is explained by PartialAgentRecord FK cascade",
      drift_unexplained: "drift - drift_explained (must be 0 before Phase 2 starts)",
      field_diffs: "Array of field-level discrepancies in spot-checked rows",
      acceptance_tests:
        "unread_count_drift: [{address, kv_cached, d1_count, drift}] — Phase 2.5 gate",
    },
    operationalPlan: {
      step1: "POST ?table=all&sampleSize=50 — run full reconciliation",
      step2: "Verify drift_unexplained == 0 for all tables before Phase 2 begins",
      step3: "Check acceptance_tests.passed == true for unreadCount drift",
    },
  });
}

/**
 * POST /api/admin/reconcile
 *
 * Run KV ↔ D1 reconciliation for one or all tables.
 *
 * Query params:
 *   - table: agents | claims | inbox_messages | vouches | all (default: all)
 *   - sampleSize: 1–500 (default: 50)
 *   - acceptanceTests: unreadCount (optional; auto-included for inbox_messages/all)
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
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/admin/reconcile" })
    : createConsoleLogger({ rayId, path: "/api/admin/reconcile" });

  const { searchParams } = new URL(request.url);
  const rawTable = searchParams.get("table") ?? "all";
  const sampleSize = parseSampleSize(searchParams.get("sampleSize"));
  const includeUnreadTest =
    rawTable === "all" ||
    rawTable === "inbox_messages" ||
    searchParams.get("acceptanceTests") === "unreadCount";

  const validTables = ["agents", "claims", "inbox_messages", "vouches", "all"];
  if (!validTables.includes(rawTable)) {
    return NextResponse.json(
      { error: `Invalid table "${rawTable}". Must be one of: ${validTables.join(", ")}` },
      { status: 400 }
    );
  }

  logger.info("reconcile.start", { table: rawTable, sampleSize });

  try {
    if (rawTable === "all") {
      // Build full-agent set once — shared by claims/inbox/vouches for KV-truth drift_explained
      const fullAgents = await buildFullAgentSet(kv);

      // Run all tables sequentially (D1 query budget concerns); track per-table duration
      let tableStart = Date.now();
      logger.info("reconcile.table.start", { table: "agents" });
      const agentsResult = await reconcileAgents(kv, db, sampleSize);
      const agentsDuration = Date.now() - tableStart;
      logger.info("reconcile.table.done", {
        table: "agents",
        drift: agentsResult.drift,
        drift_unexplained: agentsResult.drift_unexplained,
        duration_ms: agentsDuration,
      });
      if (agentsResult.drift_unexplained !== 0) {
        logger.warn("reconcile.drift.unexplained", { table: "agents", drift_unexplained: agentsResult.drift_unexplained });
      }

      tableStart = Date.now();
      logger.info("reconcile.table.start", { table: "claims" });
      const claimsResult = await reconcileClaims(kv, db, sampleSize, fullAgents);
      const claimsDuration = Date.now() - tableStart;
      logger.info("reconcile.table.done", {
        table: "claims",
        drift: claimsResult.drift,
        drift_unexplained: claimsResult.drift_unexplained,
        duration_ms: claimsDuration,
      });
      if (claimsResult.drift_unexplained !== 0) {
        logger.warn("reconcile.drift.unexplained", { table: "claims", drift_unexplained: claimsResult.drift_unexplained });
      }

      tableStart = Date.now();
      logger.info("reconcile.table.start", { table: "inbox_messages" });
      const inboxResult = await reconcileInboxMessages(kv, db, sampleSize, fullAgents);
      const inboxDuration = Date.now() - tableStart;
      logger.info("reconcile.table.done", {
        table: "inbox_messages",
        drift: inboxResult.drift,
        drift_unexplained: inboxResult.drift_unexplained,
        duration_ms: inboxDuration,
      });
      if (inboxResult.drift_unexplained !== 0) {
        logger.warn("reconcile.drift.unexplained", { table: "inbox_messages", drift_unexplained: inboxResult.drift_unexplained });
      }

      tableStart = Date.now();
      logger.info("reconcile.table.start", { table: "vouches" });
      const vouchesResult = await reconcileVouches(kv, db, sampleSize, fullAgents);
      const vouchesDuration = Date.now() - tableStart;
      logger.info("reconcile.table.done", {
        table: "vouches",
        drift: vouchesResult.drift,
        drift_unexplained: vouchesResult.drift_unexplained,
        duration_ms: vouchesDuration,
      });
      if (vouchesResult.drift_unexplained !== 0) {
        logger.warn("reconcile.drift.unexplained", { table: "vouches", drift_unexplained: vouchesResult.drift_unexplained });
      }

      const acceptance_tests = includeUnreadTest
        ? await runUnreadCountAcceptanceTest(kv, db)
        : undefined;

      if (acceptance_tests) {
        logger.info("reconcile.acceptance.done", {
          unread_drift_count: acceptance_tests.unread_count_drift.length,
          passed: acceptance_tests.passed,
        });
        if (!acceptance_tests.passed) {
          logger.warn("reconcile.acceptance.failed", {
            entries: acceptance_tests.unread_count_drift.filter((e) => e.drift !== 0),
          });
        }
      }

      const duration_ms = Date.now() - start;
      const total_drift_unexplained =
        agentsResult.drift_unexplained +
        claimsResult.drift_unexplained +
        inboxResult.drift_unexplained +
        vouchesResult.drift_unexplained;

      logger.info("reconcile.complete", {
        table: "all",
        total_drift_unexplained,
        duration_ms,
      });

      const response: ReconcileAllResponse = {
        tables: [
          { ...agentsResult, duration_ms: agentsDuration },
          { ...claimsResult, duration_ms: claimsDuration },
          { ...inboxResult, duration_ms: inboxDuration },
          { ...vouchesResult, duration_ms: vouchesDuration },
        ],
        total_drift_unexplained,
        acceptance_tests,
        duration_ms,
      };
      return NextResponse.json(response);
    }

    // Single table — build fullAgents only when needed
    const table = rawTable as TableTarget;
    logger.info("reconcile.table.start", { table });

    let result: Omit<TableReconcileResult, "duration_ms">;
    switch (table) {
      case "agents":
        result = await reconcileAgents(kv, db, sampleSize);
        break;
      case "claims": {
        const fullAgents = await buildFullAgentSet(kv);
        result = await reconcileClaims(kv, db, sampleSize, fullAgents);
        break;
      }
      case "inbox_messages": {
        const fullAgents = await buildFullAgentSet(kv);
        result = await reconcileInboxMessages(kv, db, sampleSize, fullAgents);
        break;
      }
      case "vouches": {
        const fullAgents = await buildFullAgentSet(kv);
        result = await reconcileVouches(kv, db, sampleSize, fullAgents);
        break;
      }
    }

    const duration_ms = Date.now() - start;

    logger.info("reconcile.table.done", {
      table,
      drift: result.drift,
      drift_unexplained: result.drift_unexplained,
      field_diffs: result.field_diffs.length,
      duration_ms,
    });

    if (result.drift_unexplained !== 0) {
      logger.warn("reconcile.drift.unexplained", {
        table,
        drift_unexplained: result.drift_unexplained,
      });
    }

    let acceptance_tests: AcceptanceTestResults | undefined;
    if (includeUnreadTest) {
      acceptance_tests = await runUnreadCountAcceptanceTest(kv, db);
      logger.info("reconcile.acceptance.done", {
        unread_drift_count: acceptance_tests.unread_count_drift.length,
        passed: acceptance_tests.passed,
      });
      if (!acceptance_tests.passed) {
        logger.warn("reconcile.acceptance.failed", {
          entries: acceptance_tests.unread_count_drift.filter((e) => e.drift !== 0),
        });
      }
    }

    const response: ReconcileResponse = {
      ...result,
      duration_ms,
      ...(acceptance_tests ? { acceptance_tests } : {}),
    };
    return NextResponse.json(response);
  } catch (e) {
    const duration_ms = Date.now() - start;
    logger.warn("reconcile.error", {
      table: rawTable,
      reason: (e as Error).message,
      duration_ms,
    });
    return NextResponse.json(
      {
        error: `Reconciliation failed: ${(e as Error).message}`,
        table: rawTable,
        duration_ms,
      },
      { status: 500 }
    );
  }
}
