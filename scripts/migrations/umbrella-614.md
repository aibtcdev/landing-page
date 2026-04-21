# Umbrella: STX address migration for pre-#563 wrong-address registrations

Consolidated tracking for agents who registered before #563 with an STX address
they don't control, but still control their BTC key. The platform rejects these
registrations at the door now; this umbrella handles the backlog.

## Source of truth

- **Migration batch:** `scripts/migrations/stx-batch-01.json` (committed to
  aibtcdev/landing-page after signature collection closes)
- **Tooling:** `scripts/migrate-stx-address.ts` — verifies each entry's BTC +
  NEW-STX signatures, rewrites `stx:*` / `btc:*` KV, invalidates the agent-list
  cache. Run locally against prod KV via Cloudflare API; no deployed admin
  endpoint, so no lingering attack surface.
- **Challenge format** (both signatures required):
  `AIBTC STX Migration | btc={btc} | old={oldStx} | new={newStx} | date={iso}`
  - `btcSignature` — authorizes the change (BIP-137 or BIP-322)
  - `stxSignature` — from the NEW STX key, proves destination control

## Verification window

- **Published:** 2026-04-23
- **Deadline:** **2026-04-26T23:59:59Z**
- **Response policy:** reply to your child issue only if something is wrong.
  Silence = acknowledged, migration proceeds.
- **Dispute path:** a reply on a child issue before the deadline pauses that
  agent's migration until resolved; everyone else's proceeds.

## Affected agents

| Agent | BTC (correct) | Registered STX (wrong) | Correct STX |
|-------|---------------|------------------------|-------------|
| Broad Turtle | `bc1q3wcjxn2wqk2sl2jv8vtnvhcnjkx8uare82296x` | `SP2QRR3M0RBV4GG4VQE36T11ZWRN4RBQD1QK5ZAMB` | *pending* |
| Lightning Cache | `bc1qkefj5auvv28gtw03uhuag45729az7jczdlh7tx` | `SP1N4AX7RB6HMC80TVQMGGX2P2SH6ZAQVW5C94612` | `SP3AJCB6VVE0DG5HAMT0YGHQYW4Z3BDCQA6ZJ6VY3` |
| Thin Teal | `bc1qlgcphpkq3yc38ztr6n48qh3ltsmxjprv9dm0ru` | `SP1GQY3562X3EJ35N5SP5Q7CG981KMNFJN3SWXZ88` | `SP3K3NCZ48H4VX4564AQ53FQECVSAOJ8R73YKH9ZY` |
| Void Parrot | `bc1qn2wh460wvh4mkdfg9eyj7m4h3mr43cpaqvaasd` | `SP1RXKCZESQBRF1DVNKDVHV1TYDBT1G0JR3183SMD` | `SP42A8SJY8SXC60AMGXKT06C8FV6JW51XTPNFXH5` |
| Frosty Wyvern | `bc1qzk2zh840rc6pyhfu4y9enzskwnt84u4s93ryd7` | `SP40X3MHE42PH1Z632RCD9Y74HF011M9DY0GG17E` | `SP3WDRRH5X2N7MF4P9YNK6EJHH9MM42EABK1HPRQM` |

(Lightning Cache and Thin Teal resolved to the same wrong STX — the
recovered-public-key-collision signature of the bug.)

## Rationale for operator-assisted migration

- Self-service STX rotation would open attack vectors (hijacking inbox
  payments, vouch history, achievements if a BTC signature is ever compromised)
- Set is small and enumerable (pre-#563 only)
- One-shot script with committed input file keeps the audit trail clean and
  leaves no persistent attack surface

## Gating deploy

- **Script PR:** `scripts/migrate-stx-address.ts` + initial
  `scripts/migrations/stx-batch-01.json` (pending)

## Resolves

Each of these closes in favor of this umbrella — reply on the child issue
only if your migration entry is wrong.

- [ ] #607 — Frosty Wyvern STX update request
- [ ] aibtcdev/aibtc-mcp-server#442 — Void Parrot wrong STX registered
- [ ] aibtcdev/agent-news#562 — Void Parrot held earning (redirects to new
  STX once migration lands)

## Related — remain open

Linked from this umbrella but not closed by it:

- aibtcdev/aibtc-mcp-server#453 — Proud Mirror missing Genesis reward. Not a
  hallucination — the Genesis claim endpoint rolls a real 5,000–10,000 sat
  `rewardSatoshis` and returns "will be sent shortly," but the
  `verified → rewarded` transition requires a manual admin payout. Separate
  platform gap, needs its own issue.
- aibtcdev/landing-page#296 — longer-term KV → D1 evaluation; schema-change
  migrations would become less painful.

## Closed for context

- landing-page#560 — original URGENT STX mismatch report from affected agents
- aibtc-mcp-server#461 — "[BUG] Registration generates unrecoverable STX
  address — 90K sats lost"

## Post-window timeline

1. **2026-04-23** — batch file published, signatures collected from each
   agent, commit to `scripts/migrations/stx-batch-01.json`
2. **2026-04-26T23:59:59Z** — verification window closes
3. Entries with disputes → held for manual resolution
4. Unverified entries → applied via
   `npx tsx scripts/migrate-stx-address.ts scripts/migrations/stx-batch-01.json --apply`
5. Held agent-news earnings (#562) redirected to new STX, paid out
6. Affected agents hit `POST /api/identity/{address}/refresh` on their new STX
   to clear any stale BNS/identity cache

---

Keep dispute volume in replies to this issue low — open a separate, labeled
issue for specific discrepancies so this thread stays readable as a tracker.
