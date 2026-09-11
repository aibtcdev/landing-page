/**
 * Chainhooks 2.0 delivery parsing for the legion contracts, and the webhook's
 * shared-secret check.
 *
 * Ported from news-legion (src/lib/chainhook.ts, src/lib/webhook-auth.ts). The
 * 2.0 payload differs from classic Chainhook in ways that all fail silently: a
 * parser written against the old shape finds zero events and still returns 200.
 *
 *   apply/rollback are under `event`, not top-level
 *   per-tx events are `operations`, not `metadata.receipt.events`
 *   the print type is `contract_log`, not `SmartContractEvent`
 *   fields hang off `metadata`, not `data`
 *   failure is `metadata.status !== "success"`, not `metadata.success === false`
 */

import { asNumber, decodeClarityHex, toPlain } from "./clarity";

/** One decoded print event from a watched legion contract. */
export interface EventRow {
  txid: string;
  event_index: number;
  /** The contract that emitted it. Both legions land in one table. */
  contract_id: string;
  proposal_id: number | null;
  /** Stacks height of the block that carried it. */
  block_height: number;
  /** Unix seconds of that block, when the delivery carried one. */
  block_time: number | null;
  event: string;
  data: Record<string, unknown>;
  /** Wall-clock ms the row was stored. Only set on the read path. */
  recorded_at?: number;
}

export interface ChainhookOccurrence {
  chainhook?: { uuid?: string; name?: string };
  event?: {
    apply?: ChainhookBlock[];
    rollback?: ChainhookBlock[];
  };
}

export interface ChainhookBlock {
  block_identifier?: { index?: number };
  timestamp?: number;
  metadata?: { burn_block_timestamp?: number };
  transactions?: ChainhookTransaction[];
}

interface ChainhookTransaction {
  transaction_identifier?: { hash?: string };
  operations?: ChainhookOperation[];
  metadata?: { status?: string };
}

interface ChainhookOperation {
  type?: string;
  operation_identifier?: { index?: number };
  metadata?: {
    contract_identifier?: string;
    topic?: string;
    /** Decoded object, or {hex, repr}, or a bare hex string. All three occur. */
    value?: unknown;
  };
}

function decodeTuple(hex: string): Record<string, unknown> | null {
  const cv = decodeClarityHex(hex);
  if (!cv) return null;
  const plain = toPlain(cv);
  return plain && typeof plain === "object" && !Array.isArray(plain)
    ? (plain as Record<string, unknown>)
    : null;
}

/**
 * Normalise a print event's `value` into a plain object.
 *
 * The hex is preferred whenever it is present: it decodes to exact numbers and
 * principals with the same codec the read path uses. A pre-decoded object is
 * accepted as a fallback, and `asNumber` downstream reads its uints in any
 * spelling.
 */
function normaliseValue(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") return value.startsWith("0x") ? decodeTuple(value) : null;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.hex === "string") return decodeTuple(obj.hex);
    if (typeof obj.event === "string") return obj;
  }
  return null;
}

/**
 * Flatten a chainhook payload into rows.
 *
 * Only `contract_log` operations from a WATCHED contract are kept, and only from
 * successful transactions: an aborted `conclude` must never render as a
 * conclusion that happened.
 */
export function extractEvents(
  blocks: readonly ChainhookBlock[],
  contracts: readonly string[]
): EventRow[] {
  const watched = new Set(contracts);
  const out: EventRow[] = [];

  for (const block of blocks) {
    const height = block.block_identifier?.index;
    if (typeof height !== "number") continue;
    const blockTime = block.timestamp ?? block.metadata?.burn_block_timestamp ?? null;

    for (const tx of block.transactions ?? []) {
      if (tx.metadata?.status && tx.metadata.status !== "success") continue;
      const txid = tx.transaction_identifier?.hash;
      if (!txid) continue;

      (tx.operations ?? []).forEach((op, i) => {
        if (op.type !== "contract_log") return;
        const emitter = op.metadata?.contract_identifier;
        if (!emitter || !watched.has(emitter)) return;
        const data = normaliseValue(op.metadata?.value);
        const name = data && typeof data.event === "string" ? data.event : null;
        if (!data || !name) return;
        out.push({
          txid,
          event_index: op.operation_identifier?.index ?? i,
          contract_id: emitter,
          proposal_id: asNumber(data.proposalId),
          block_height: height,
          block_time: blockTime,
          event: name,
          data,
        });
      });
    }
  }

  return out;
}

export function rollbackTxids(blocks: readonly ChainhookBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    for (const tx of block.transactions ?? []) {
      const hash = tx.transaction_identifier?.hash;
      if (hash) ids.push(hash);
    }
  }
  return ids;
}

/**
 * Chainhooks 2.0 has no per-hook auth header: authentication is the
 * account-wide consumer secret, sent as `x-chainhook-consumer-secret`. The
 * destination URL also carries it as `?t=`, the one part we fully control, so
 * either carrier is accepted. Fails closed.
 */
const SECRET_HEADERS = ["x-chainhook-consumer-secret", "x-chainhook-secret", "authorization"];

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthorisedDelivery(request: Request, secret: string): boolean {
  for (const name of SECRET_HEADERS) {
    const raw = request.headers.get(name);
    if (!raw) continue;
    const value = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
    if (safeEqual(value, secret)) return true;
  }
  const token = new URL(request.url).searchParams.get("t");
  return token ? safeEqual(token, secret) : false;
}
