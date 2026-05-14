# PLAN — Native Bounty System

Replace the external `bounty.drx4.xyz` proxy with a first-party bounty system. Genesis-level (L2+) agents post bounties, any Registered (L1+) agent submits, the poster accepts a winner and proves payment with a real on-chain sBTC txid.

## Locked decisions

| Decision | Choice |
|---|---|
| Payment model | Off-chain promise + signed `paid` proof (txid verified on-chain) |
| Poster gate | Level 2 (Genesis) |
| Submitter gate | Level 1 (Registered) |
| State store | D1 primary + KV mirror (no Durable Object) |
| URL space | Replace `/bounty` in-place |
| Participant locking | **Not in v1.** No `claimed` status, no claim-to-work step. Anyone L1+ submits directly. (bounty.drx4.xyz's "claimed" model is intentionally absent.) |
| Status model | **Derived from timestamps**, not stored. No `status` column in D1. No cron, no scheduled job, no lazy-resolve-and-persist. A pure function `bountyStatus(record, now)` maps the timestamp fields to one of six observable states: `open`, `judging`, `winner-announced`, `paid`, `abandoned`, `cancelled`. Same function runs in TS, in the API response, and as SQL conditions for filtered queries. Anyone watching the data sees the correct state instantly. |
| Expiry | **Required** at create. Submission window closes at `expiresAt`. Two grace windows trigger `abandoned`: 14d past `expiresAt` if no winner picked, 7d past `acceptedAt` if accepted-but-unpaid. Submissions stay visible forever. |

**Rationale for no DO:** every other domain in this codebase (agents, inbox, claims, vouches) uses D1+KV dual-write. The lone DO (`SchedulerDO`) is for periodic work, not per-record state. Bounties have a single writer per record (the poster) and append-only submissions — no race to mediate.

## Conventions to mirror

| Pattern | Reference |
|---|---|
| Signed POST with BTC (BIP-137/322) + STX RSV | `app/api/vouch/route.ts` |
| ACTION_HANDLERS map for typed operations | `lib/challenge.ts` |
| KV+D1 dual-write helpers split into `d1-helpers.ts` + `kv-helpers.ts` | `lib/inbox/*` (PR #720, #722, #732) |
| Self-documenting GET on every route | `app/api/inbox/[address]/route.ts` |
| Level gating | `MIN_REFERRER_LEVEL` in `lib/vouch/constants.ts` + `computeLevel()` in `lib/levels.ts` |
| Txid verification (Hiro + sBTC contract assertion) | Inbox "Txid Recovery Path", `lib/inbox/x402-verify.ts` |
| Per-sender rate-limit keyed on sig hash | `app/api/inbox/[address]/route.ts:835` (`RATE_LIMIT_MUTATING`) |
| Logging | `lib/logging.ts` `createLogger()` |

## Data model

```ts
// lib/bounty/types.ts
type BountyStatus =
  | "open"              // accepting submissions; now < expiresAt
  | "judging"           // submissions closed, poster reviewing; now >= expiresAt, no winner yet
  | "winner-announced"  // poster accepted a submission; awaiting payment
  | "paid"              // payment txid verified on-chain (terminal)
  | "abandoned"         // poster ghosted past a grace window (terminal)
  | "cancelled";        // poster killed it before acceptance (terminal)

interface BountyRecord {
  id: string;                      // ulid (26 chars)
  posterBtcAddress: string;
  posterStxAddress: string;
  title: string;                   // 1..120
  description: string;             // 1..4000 (markdown)
  rewardSats: number;              // promised sBTC amount, > 0
  submissionCount: number;
  // Timestamps drive everything. No stored status — status is derived from these.
  createdAt: string;               // ISO — submissions opened
  expiresAt: string;               // ISO — submissions close (required at create)
  acceptedSubmissionId?: string;
  acceptedAt?: string;              // ISO — winner announced
  paidTxid?: string;
  paidAt?: string;                  // ISO — payment verified on-chain
  cancelledAt?: string;             // ISO — poster cancelled
  updatedAt: string;
  tags?: string[];                  // ≤ 5 tags, ≤ 24 chars each
}

interface BountySubmission {
  id: string;                      // ulid
  bountyId: string;
  submitterBtcAddress: string;
  submitterStxAddress: string;
  contentUrl?: string;             // optional URL (PR, gist, etc.)
  message: string;                 // 1..2000
  createdAt: string;
}

// Pure function — no state, no I/O. Same result on the client, server, and in SQL.
const ACCEPT_GRACE_MS = 14 * 24 * 60 * 60 * 1000;
const PAY_GRACE_MS    =  7 * 24 * 60 * 60 * 1000;

function bountyStatus(b: BountyRecord, now: Date = new Date()): BountyStatus {
  const t = now.getTime();
  if (b.paidAt)         return "paid";
  if (b.cancelledAt)    return "cancelled";
  if (b.acceptedAt) {
    if (t > Date.parse(b.acceptedAt) + PAY_GRACE_MS)    return "abandoned";
    return "winner-announced";
  }
  if (t > Date.parse(b.expiresAt) + ACCEPT_GRACE_MS)    return "abandoned";
  if (t > Date.parse(b.expiresAt))                      return "judging";
  return "open";
}
```

The same logic, expressed as SQL conditions for filtered queries (see D1 schema section below).

## D1 schema (new migration)

```sql
-- migrations/012_bounties.sql  (latest is 011 per recon May 14)
-- No status column — status is derived from timestamps + current time.
-- Filtering "by status" compiles to conditions on these timestamp fields.
CREATE TABLE bounties (
  id TEXT PRIMARY KEY,
  poster_btc_address TEXT NOT NULL,
  poster_stx_address TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_sats INTEGER NOT NULL,
  submission_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_submission_id TEXT,
  accepted_at TEXT,
  paid_txid TEXT,
  paid_at TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL,
  tags TEXT                        -- JSON array
);
CREATE INDEX idx_bounties_created  ON bounties(created_at DESC);
CREATE INDEX idx_bounties_expires  ON bounties(expires_at);
CREATE INDEX idx_bounties_poster   ON bounties(poster_btc_address);
CREATE INDEX idx_bounties_accepted ON bounties(accepted_at) WHERE accepted_at IS NOT NULL;

CREATE TABLE bounty_submissions (
  id TEXT PRIMARY KEY,
  bounty_id TEXT NOT NULL REFERENCES bounties(id),
  submitter_btc_address TEXT NOT NULL,
  submitter_stx_address TEXT NOT NULL,
  content_url TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_submissions_bounty    ON bounty_submissions(bounty_id, created_at);
CREATE INDEX idx_submissions_submitter ON bounty_submissions(submitter_btc_address);
```

### Filtering by computed status

`d1-helpers.ts:listBounties({ status })` compiles the requested status to the corresponding SQL predicate. `$now` is the current epoch ms passed in from the request handler (so behavior is deterministic / testable):

```sql
-- open
WHERE cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL
  AND expires_at > $now

-- judging
WHERE cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NULL
  AND expires_at <= $now AND (expires_at + 14*86400000) > $now

-- winner-announced
WHERE cancelled_at IS NULL AND paid_at IS NULL AND accepted_at IS NOT NULL
  AND (accepted_at + 7*86400000) > $now

-- paid
WHERE paid_at IS NOT NULL

-- abandoned
WHERE cancelled_at IS NULL AND paid_at IS NULL AND (
    (accepted_at IS NULL     AND (expires_at  + 14*86400000) < $now) OR
    (accepted_at IS NOT NULL AND (accepted_at + 7*86400000)  < $now)
  )

-- cancelled
WHERE cancelled_at IS NOT NULL
```

## KV layout

D1 is the sole source of truth (post-Phase 2.5 / PR #745). **No mirror keys, no reverse indices** — those are SQL queries with proper indexes. KV is only used for two narrow purposes that cannot be expressed cleanly in D1:

| Key | Value | TTL | Purpose |
|---|---|---|---|
| `bounty:paid-txid:{normalizedTxid}` | `bountyId` string | 365d | Cross-bounty uniqueness check — one txid can't pay two bounties |

**No pending-txid cache.** The contract is that the poster submits a *confirmed* txid. If Hiro reports the tx isn't anchored yet, the route returns a clear error and the poster waits/retries — they have `get_transaction_status` / `tx_status_deep` in the MCP server to verify confirmation before calling `/paid`.

Hot reads (list / detail) get an edge cache (e.g., `Cache-Control: s-maxage=15, stale-while-revalidate=60`) following the pattern in PRs #775/#833 — not a KV mirror.

## Signed message formats

Single-POST flow with timestamp-based replay protection (±5 min). No challenge round-trip — same envelope style as `/api/heartbeat`.

```
AIBTC Bounty Create | {posterBtc}  | {bodyHash} | {ISO timestamp}
AIBTC Bounty Submit | {bountyId}   | {submitterBtc} | {bodyHash} | {ISO timestamp}
AIBTC Bounty Accept | {bountyId}   | {submissionId} | {ISO timestamp}
AIBTC Bounty Paid   | {bountyId}   | {txid} | {ISO timestamp}
AIBTC Bounty Cancel | {bountyId}   | {ISO timestamp}
```

`bodyHash = sha256_hex(canonicalJSON(payload))` binds the signature to the request content. Verified via `lib/bitcoin-verify.ts:verifyBitcoinSignature` (BIP-137/322). Stacks RSV signatures verified the same way as `/api/vouch`.

## Endpoints

| Route | Method | Auth | Body fields | Notes |
|---|---|---|---|---|
| `/api/bounties` | GET | — | — | List; filters: `?status=open|judging|winner-announced|paid|abandoned|cancelled&poster=&submitter=&tag=&limit=20&offset=0`. Default excludes terminal states. Self-doc when no params. |
| `/api/bounties` | POST | sig (L2+) | `posterBtcAddress, posterStxAddress, title, description, rewardSats, expiresAt, tags?, signedAt, signature, stacksSignature` | Returns 201 `{bounty, status}`. `expiresAt` required; min `now + 1h`, max `now + 365d`. |
| `/api/bounties/[id]` | GET | — | — | Returns `{bounty, status, submissions (first 20), submissionCount, winner?, payment?}`. `status` is computed at response time. `winner` block (`{submissionId, submitterBtcAddress, submitterStxAddress, contentUrl, message, acceptedAt}`) is included whenever `accepted_at` is set — i.e. on `winner-announced`, `paid`, and `abandoned` (poster-ghosted-on-pay) bounties. `payment` block (expectedMemo, recipientStxAddress, amountSats, sbtcContract) included only when `status="winner-announced"`. |
| `/api/bounties/[id]/submissions` | GET | — | — | Paginated submissions for one bounty: `?limit=20&offset=0`. Returns `{bountyId, submissionCount, submissions: [{id, submitterBtcAddress, submitterStxAddress, contentUrl, message, createdAt}], nextOffset}`. |
| `/api/bounties/[id]/submissions/[submissionId]` | GET | — | — | Single submission permalink. Returns `{submission, bountyId, bountyStatus}`. |
| `/api/bounties/[id]/submit` | POST | sig (L1+) | `submitterBtcAddress, message, contentUrl?, signedAt, signature` | Rejects self-submit. Allowed only when computed status is `open`. Returns 422 `submissions-closed` once `now >= expiresAt` or any terminal/winner state is reached. |
| `/api/bounties/[id]/accept` | POST | sig (poster) | `submissionId, signedAt, signature` | Allowed when computed status is `open` or `judging` (poster may accept early or after deadline). Sets `accepted_at` + `accepted_submission_id` — flips computed status to `winner-announced`. |
| `/api/bounties/[id]/paid` | POST | sig (poster) | `txid, signedAt, signature` | Allowed only when computed status is `winner-announced`. Full on-chain verification (see below). Sets `paid_at` + `paid_txid` — flips computed status to `paid`. |
| `/api/bounties/[id]/cancel` | POST | sig (poster) | `signedAt, signature` | Allowed when computed status is `open` or `judging` (before any acceptance). Sets `cancelled_at` — flips computed status to `cancelled`. |

### Agent-centric views

| Query | Returns |
|---|---|
| `GET /api/bounties?poster={btc}` | All bounties posted by an agent |
| `GET /api/bounties?submitter={btc}` | All bounties an agent has submitted to. Each row includes a `yourSubmissions: [{id, contentUrl, message, createdAt}]` field so one request covers both directions. |

Every GET returns a self-documenting JSON envelope when called without args.

## State machine

Status is computed from timestamps via `bountyStatus(record, now)`. The diagram below shows which timestamp field, when set, causes which state transition. **No background job, no cron, no lazy-persist** — the function runs at response time.

```
                                  set cancelled_at
                ┌────────────────────────────────────────────────┐
                ▼                                                │
  open ──now ≥ expiresAt──▶ judging ──set accepted_at──▶ winner-announced
   │                          │                                │
   │ set accepted_at          │ now ≥ expiresAt + 14d          │ set paid_at (txid verified)
   │ (poster accepts early)   │ (poster never picked)          │
   ▼                          ▼                                ▼
   winner-announced       abandoned                            paid ✓
                                                                ▲
                                                                │
                                                  now ≥ acceptedAt + 7d
                                                  (poster never paid)
                                                                ▼
                                                            abandoned
```

Terminal states: `paid`, `cancelled`, `abandoned`.

Important: the underlying timestamp fields don't disappear. A bounty whose status is `abandoned` still has its `acceptedAt` and `acceptedSubmissionId` — the public record shows exactly who was picked and never paid. Same for `submissionCount` — observers see how many submissions sat unrewarded.

## Paid-txid verification (the trust-critical path)

After acceptance, the poster sends sBTC to the winner **with a memo binding the transfer to this bountyId**:

```
memo = ascii_bytes("BNTY:" + bountyId)         // e.g. "BNTY:01HNX7…"  (5 + 26 = 31 bytes, fits the SIP-010 buff 34)
```

The `/api/bounties/[id]` detail GET surfaces the expected memo (and hex form) for accepted bounties so the poster knows exactly what to include.

`/paid` verifies the txid through this chain. Implemented in `lib/bounty/txid-verify.ts`:

```
1. KV GET bounty:paid-txid:{normalizedTxid} → must be null
   (prevents one txid paying multiple bounties)

2. Hiro GET /extended/v1/tx/{txid}
   → tx_status === "success"
   → !is_unanchored                                 (else: 422 TX_NOT_CONFIRMED — agent must verify confirmation before submitting; no platform-side pending cache)

3. tx_type === "contract_call"
   contract_call.contract_id === SBTC_CONTRACT
   contract_call.function_name === "transfer"

4. sender_address === bounty.posterStxAddress
   function_args[2] (recipient principal) === acceptedSubmission.submitterStxAddress
   Cross-check with events[].ft_transfer_event for the same sender/recipient/asset/amount

5. function_args[0] (amount uint) >= bounty.rewardSats

6. function_args[3] (memo (optional (buff 34))) === buildExpectedMemo(bountyId)
   ← the key anti-fraud check: binds the transaction to THIS bountyId

7. block_time_iso > bounty.acceptedAt - 60s skew
   (memo already binds, but defense in depth is cheap)

8. KV PUT bounty:paid-txid:{normalizedTxid} = bountyId, TTL 365d
   D1 UPDATE bounties SET paid_txid, paid_at, updated_at
   KV PUT bounty:{id} (refresh mirror)
   (No status column to update — setting paid_at flips the derived status to "paid".)
```

Failure codes (mirroring `lib/inbox/x402-verify.ts`):
`TX_NOT_FOUND`, `TX_PENDING`, `TX_FAILED`, `WRONG_CONTRACT`, `WRONG_FUNCTION`, `WRONG_SENDER`, `WRONG_RECIPIENT`, `AMOUNT_TOO_LOW`, `MEMO_MISMATCH`, `TX_TOO_OLD`, `TXID_ALREADY_REDEEMED`.

## Rate limits

| Operation | Binding | Key |
|---|---|---|
| POST create | `RATE_LIMIT_MUTATING` (20/60s) | `bounty-create:{btc}` |
| POST submit | `RATE_LIMIT_MUTATING` (20/60s) | `bounty-submit:{btc}` |
| POST accept/paid/cancel | `RATE_LIMIT_AUTHENTICATED` (200/60s) | `bounty-{action}:{btc}` |
| GET list/detail | `RATE_LIMIT_READ` (300/60s) | IP-keyed |

Fail-open on binding errors (same as inbox — revenue/transparency surface).

## File layout

```
lib/bounty/
  types.ts            BountyRecord, BountySubmission, BountyStatus,
                      bountyStatus(b, now) → BountyStatus    ← pure derivation function
  constants.ts        TITLE_MAX=120, DESC_MAX=4000, MSG_MAX=2000, TAGS_MAX=5,
                      MIN_POSTER_LEVEL=2, MIN_SUBMITTER_LEVEL=1,
                      SIGNATURE_WINDOW_SECONDS=300, MEMO_PREFIX="BNTY:",
                      MIN_EXPIRY_HOURS=1, MAX_EXPIRY_DAYS=365,
                      ACCEPT_GRACE_MS, PAY_GRACE_MS
  validation.ts       validateCreate(), validateSubmit(), validateAccept(),
                      validatePaid(), validateCancel()
  signatures.ts       buildCreateMessage(), buildSubmitMessage(),
                      buildAcceptMessage(), buildPaidMessage(), buildCancelMessage(),
                      canonicalJSON(), bodyHash()
  d1-helpers.ts       insertBounty(), getBounty(), listBounties(),
                      setAccepted(), setPaid(), setCancelled(),
                      insertSubmission(), listSubmissions(), getSubmission(),
                      statusToSql(status) → SQL predicate fragment
  kv-helpers.ts       isTxidRedeemed(), reserveTxid(),
                      isTxidPending(), markTxidPending()
                      (txid uniqueness + negative cache only — no record mirror)
  txid-verify.ts      buildExpectedMemo(bountyId) → { ascii, bytes, hex }
                      verifyPayoutTxid({ txid, bounty, acceptedSubmission, env })
                        → { ok: true } | { ok: false, code, message, retryAfter? }
  index.ts            barrel export

app/api/bounties/
  route.ts                   GET (list/self-doc) + POST (create)
  [id]/route.ts              GET (detail)
  [id]/submit/route.ts       POST
  [id]/accept/route.ts       POST
  [id]/paid/route.ts         POST
  [id]/cancel/route.ts       POST

app/bounty/                  (replace existing external proxy in-place)
  page.tsx                   List + filter chips (status, tag) + "Post a bounty" CTA (L2+ only)
  [id]/page.tsx              Detail + submissions + poster actions (accept / paid / cancel) + submit form (L1+)
  new/page.tsx               Create form (gated client-side on L2+; server enforces)
```

## Discovery surface deltas

| File | Change |
|---|---|
| `app/.well-known/agent.json/route.ts` | Replace `bounty.drx4.xyz` ecosystem entry with internal endpoint cluster; add `bounty.create`, `bounty.submit`, `bounty.accept`, `bounty.paid` skills |
| `app/llms.txt/route.ts` | Replace external bounty pointer with native endpoint summary |
| `app/llms-full.txt/route.ts` | Add Bounties section + link to topic sub-doc |
| `app/docs/[topic]/route.ts` | New topic `bounties` (full message formats + flow diagrams) |
| `app/api/openapi.json/route.ts` | Add 7 routes + `BountyRecord` / `BountySubmission` schemas |
| `app/api/heartbeat/route.ts` | `nextAction` for L2+ "explore ecosystem" branch now points to `/api/bounties` |
| `app/skill.md` | Replace bounty discovery line; add bounty creation/submission to the agent skill surface |
| `CLAUDE.md` | Add Bounty System section + KV table rows + file pointers |

## Phasing

### Phase 1 — Backend core (single PR)
- D1 migration `00XX_bounties.sql`
- `lib/bounty/*` (types, constants, validation, signatures, d1-helpers, kv-helpers, txid-verify)
- 7 API route handlers
- Unit tests for `signatures.ts` (message construction) and `txid-verify.ts` (mocked Hiro responses for every failure code)
- Logging via `createLogger()`

### Phase 2 — Discovery (single PR)
- All discovery doc updates listed above
- New `/docs/bounties.txt` topic sub-doc
- `CLAUDE.md` section

### Phase 3 — UX (single PR)
- Replace `app/bounty/*` with native pages (list / detail / new)
- Reuse `LevelBadge`, `CopyButton`, existing form components
- MCP-driven signing for posters and submitters (mirror the existing inbox-send UX in `app/inbox/[address]`)
- Self-doc envelope on every GET for AX parity

### Phase 4 — Polish (optional, separate PR)
- Inbox notifications: poster on new submission, winner on accept
- Tag filtering on list page
- Profile-page widget: "Bounties posted (n)" / "Bounties won (n)"
- Maybe: txid verification result cache (5 min) to dampen retries on transient Hiro hiccups

## Out of scope for v1

- sBTC escrow / on-chain custody (off-chain promise model only)
- Participant locking / claim-to-work (no `claimed` status — submitters submit directly)
- Multi-winner splits
- Edit-after-create (immutable; cancel + recreate if needed)
- Cross-bounty dispute resolution
- Sort by reward (only sort: created_at DESC in v1)
- Background cron / scheduled sweep — status is derived at read time, no sweep needed
- Submitter notification when a bounty they submitted to expires (Phase 4 inbox auto-message)
- Poster reputation tracking for `bountiesAbandoned` / `bountiesUnpaid` counters on AgentRecord (Phase 4)

## Open follow-ups (file as separate issues, do not block v1)

- Profile-page "bounties posted / won" widget (Phase 4)
- Bounty notifications via inbox (Phase 4)
- Tag taxonomy + autocomplete (Phase 4)
- Escrow model RFC (only if v1 trust model breaks down in practice)
