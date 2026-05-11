/**
 * Chainhook payload validation + HMAC auth for the trading-comp verifier.
 *
 * Phase 3.1 PR-C — receives chainhook predicate firings from Hiro's
 * controller (or our own self-hosted controller). The chainhook payload
 * is a JSON envelope with `apply` (rolled-forward txs) and `rollback`
 * (rolled-back txs) arrays; for the trading-comp surface we only care
 * about `apply`. Each apply entry contains a transaction the predicate
 * matched against — we hand each one to verifyAndPersistSwap with
 * source='chainhook'.
 *
 * Auth: HMAC over the request body using `env.CHAINHOOK_SECRET`. The
 * controller computes HMAC-SHA256(body) and sends it as either:
 *   - `Authorization: Bearer {hex}`  (hiro chainhook controller format)
 *   - `X-Chainhook-Signature: {hex}` (our convenience header)
 *
 * Predicate registration is OUT OF SCOPE of this PR. The chainhook needs
 * to be registered against the contracts in lib/competition/allowlist.ts —
 * that's a follow-up because it requires controller config rather than
 * landing-page changes.
 *
 * See: app/api/competition/chainhook/route.ts (transport layer).
 */

export interface ChainhookApplyEntry {
  /** The transaction body — we read tx_id from it and re-fetch via Hiro. */
  transaction?: {
    transaction_identifier?: { hash?: string };
  };
  /** Some chainhook payloads include the tx hash at the entry level. */
  txid?: string;
}

export interface ChainhookPayload {
  apply?: ChainhookApplyEntry[] | unknown;
  rollback?: unknown;
}

/** Result of payload validation. */
export type ParseChainhookResult =
  | { ok: true; txids: string[] }
  | { ok: false; reason: string };

const TXID_RE = /^(0x)?[0-9a-fA-F]{64}$/;

function normalizeTxid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!TXID_RE.test(trimmed)) return null;
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

/**
 * Pull the txid list out of a chainhook payload.
 *
 * Tolerant of both payload shapes (hash at entry-level OR nested inside
 * transaction.transaction_identifier) so we don't break if Hiro's
 * envelope shifts between controller versions.
 *
 * Rollback entries are deliberately ignored: a rollback means "this tx
 * is no longer canonical", not "this tx happened". The verifier
 * persists only terminal-status rows; if a row is rolled back, a future
 * apply with the new canonical txid will write a fresh row (different
 * txid → different PK). The original row stays in `swaps` as historical
 * audit (scoring queries can filter on tx_status if needed).
 */
export function parseChainhookPayload(payload: unknown): ParseChainhookResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "Payload is not a JSON object" };
  }
  const obj = payload as ChainhookPayload;
  const apply = obj.apply;
  if (apply === undefined) {
    return { ok: false, reason: "Payload missing required `apply` field" };
  }
  if (!Array.isArray(apply)) {
    return { ok: false, reason: "`apply` must be an array" };
  }

  const txids: string[] = [];
  for (const entry of apply as ChainhookApplyEntry[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const fromTop = normalizeTxid(entry.txid);
    if (fromTop) {
      txids.push(fromTop);
      continue;
    }
    const fromNested = normalizeTxid(entry.transaction?.transaction_identifier?.hash);
    if (fromNested) {
      txids.push(fromNested);
    }
  }
  // Dedupe — chainhook controllers occasionally batch the same txid twice
  // when the predicate matches multiple events on one tx.
  return { ok: true, txids: Array.from(new Set(txids)) };
}

/** Compute HMAC-SHA256(secret, body) and return the lowercase hex digest. */
export async function computeChainhookSignature(
  body: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Extract the signature from either `Authorization: Bearer …` or
 * `X-Chainhook-Signature: …`. Returns lowercase hex or null.
 */
export function extractChainhookSignature(headers: Headers): string | null {
  const explicit = headers.get("x-chainhook-signature");
  if (explicit) return explicit.trim().toLowerCase();
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim().toLowerCase();
  }
  return null;
}

/**
 * Constant-time HMAC compare. Both sides are hashed under a fixed key
 * before the equality check so the comparison runs in deterministic time
 * regardless of input mismatch.
 */
export async function verifyChainhookSignature(
  body: string,
  providedSig: string,
  secret: string
): Promise<boolean> {
  const expected = await computeChainhookSignature(body, secret);
  // Compare via second HMAC layer (same trick as lib/admin/auth.ts)
  const encoder = new TextEncoder();
  const compareKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("chainhook-compare"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", compareKey, encoder.encode(expected)),
    crypto.subtle.sign("HMAC", compareKey, encoder.encode(providedSig)),
  ]);
  const hexA = [...new Uint8Array(a)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const hexB = [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  return hexA === hexB;
}
