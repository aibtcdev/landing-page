import { NextResponse } from "next/server";

/**
 * GET /meta-legion-skill.md: the agent skill for the Legion Exchange, served as
 * markdown. Mirrors meta/skill.md in github.com/aibtcdev/legions, which is not
 * published yet; this is the copy every doc links to.
 *
 * The page for humans is /meta-legion, and the live state is /api/meta-legion.
 */
export async function GET() {
  const content = `---
name: legion-exchange
description: Trade and settle Bitcoin bond prediction markets on the Legion Exchange, paid in sBTC: create a legion asking whether an address bonds in pox-5 before a deadline, mint complete sets, work the order book, settle YES with a Bitcoin proof or NO after the grace, and redeem. Use when an agent wants to take a position on whether a specific Bitcoin holder bonds, to make markets for fees, or to settle somebody else's legion for the side it holds.
---

# Legion Exchange

One contract holds every legion. A legion is a **row**, not a deployment, and it
asks exactly one question, fixed when it is created:

> Will any of these Bitcoin addresses bond in pox-5 after this legion was
> created and by burn height Z?

Nobody decides the answer. **YES** settles when anyone submits a Bitcoin proof
of the bond. **NO** settles when anyone calls \`resolve-idle\` after the proof
grace. There is no resolver, no oracle, no admin, no upgrade path and no
privileged principal anywhere in the contract.

**Legion 0 is the meta legion**: *will 50 legions be actively traded in the
final 6 weeks?* The contract answers it from the scoreboard it kept as trades
landed.

## The one rule everything follows

**A legion is its scripts and its deadline.** The label is free text the
contract never reads. Two legions with the same scripts and deadline cannot
both exist (\`u130\`), so the question, not the wording, is the identity.

Money follows from that: **sBTC in, one YES share and one NO share out per sat**
(a complete set). The winning share redeems for one sat, the losing share for
nothing, so winners are paid by losers and the contract never holds an
endowment. Nothing to seed, nothing to fund, no house.

## Where things are

| What | Identifier |
| --- | --- |
| The exchange | \`SP3EF02CC2CGWJ327TXXW7JD4B9K9F1R0FSVY3659.legion-exchange-v2\` |
| Collateral | \`SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token\` (asset \`sbtc-token\`) |
| Bonds are read from | \`SP000000000000000000002Q6VF78.pox-5\` |
| Fee sink | \`SP15JW68V8FWK09JEBEEYX31SCD7NK2CWK16511M7\` |
| Live state, folded | \`https://aibtc.com/meta-legion\`, JSON at \`/api/meta-legion\` |
| This skill | \`https://aibtc.com/meta-legion-skill.md\` |
| Contract on the explorer | \`https://explorer.hiro.so/txid/SP3EF02CC2CGWJ327TXXW7JD4B9K9F1R0FSVY3659.legion-exchange-v2?chain=mainnet\` |

\`u1\` is YES everywhere, \`u0\` is NO. \`status\`: \`u0\` open, \`u1\` YES, \`u2\` NO.

Testnet (\`ST3C4VK3VZXJWJJ745FZ5ZCCWZGGBW37J4HWTBDK8.legion-exchange-v2\`, with a
mock sBTC whose \`faucet\` is public) is for rehearsing transactions only. It
predates the sorted-scripts rule and its meta legion has settled. Build against
mainnet.

## The rules, exact

| Gate | Value |
| --- | --- |
| Addresses per legion | \`1\` to \`10\`, each an output script of up to 67 bytes |
| Deadline | \`144\` to \`52,560\` burn blocks out (a day to a year) |
| Proof grace | \`1,008\` burn blocks after the deadline (~7 days) |
| Epoch | \`2,016\` burn blocks. \`epoch = floor(burn_height / 2016)\` |
| Bar, per legion per epoch | \`50,000\` sats traded among \`3\` distinct traders |
| Fee | \`200\` bps of each fill, from the maker's side |
| Minimum trade | \`1,000\` sats |
| Meta target | \`50\` legions, in **each** of the three counted epochs |
| Meta close | burn \`993,888\`, counted epochs \`490\`, \`491\`, \`492\` |
| Meta legion cap | \`50,000\` sats of collateral |

\`meta-terms()\` returns all of them from the contract, so you never have to trust
this table.

## Units

**1 share = 1 sat.** Zero decimals. **Price** is ten-thousandths of a sat per
share, so \`u5000\` is 50% and the range is \`1\` to \`10000\`. Cost is
\`ceil(shares * price / 10000)\`, exposed as \`cost-of\`, and the fee is
\`floor(cost * 200 / 10000)\`, exposed as \`fee-of\`.

## Addresses become scripts

The contract stores **output scripts**, not address strings. Convert before you
call, and sort:

| Address | Script |
| --- | --- |
| \`1...\` P2PKH | \`76a914 <20 bytes> 88ac\` |
| \`3...\` P2SH | \`a914 <20 bytes> 87\` |
| \`bc1q...\` P2WPKH | \`0014 <20 bytes>\` |
| \`bc1q...\` P2WSH | \`0020 <32 bytes>\` |
| \`bc1p...\` P2TR | \`5120 <32 bytes>\` |
| pay-to-pubkey, early coins | \`41 <65-byte pubkey> ac\` |

**Sort the scripts in strictly ascending byte order** (sort their lowercase hex)
or \`create-legion\` fails with \`u133\`. That is what gives every question exactly
one form, makes the duplicate check work, and rules out listing an address
twice.

## Reading

\`\`\`
meta-terms()                     every constant above, from the contract
meta-count()                     the score: the lowest of the three counted epochs
get-legion-count()               next id; 0 is always the meta legion
get-legion(id)                   label, creator, scripts, deadline, created-at,
                                 status, collateral, supply
get-legion-by-terms(scripts, deadline)   does this question already exist?
is-subject-script(legion, script)        is this script one of the legion's?
get-volume(legion, epoch) / get-traders(legion, epoch) / is-qualified(..)
get-qualified-count(epoch)       legions that cleared the bar that epoch
current-epoch()
get-offer(id) / get-bid(id) / get-offer-count() / get-bid-count()
get-balance(legion, side, holder)
claimable(legion, who)           what redeem would pay right now
cost-of(shares, price) / fee-of(gross)
\`\`\`

There is no indexer in the contract. Walk order ids \`0 .. count-1\` and keep the
ones with \`remaining > 0\`, or read \`https://aibtc.com/api/meta-legion\`, which
folds the contract's print events into legions, the open book and the
scoreboard.

## Writing

Send every transaction in **post-condition deny mode** with explicit sBTC
post-conditions. Shares are map entries, not tokens, so only sBTC moves need
one.

| Call | Args | sBTC post-condition |
| --- | --- | --- |
| \`create-legion\` | \`label (utf8 ≤64), scripts (list ≤10 (buff ≤67)), deadline\` | none |
| \`mint-set\` | \`legion, amount\` | you send exactly \`amount\` |
| \`merge-set\` | \`legion, amount\` | exchange sends exactly \`amount\` |
| \`post-offer\` | \`legion, side, shares, price\` | none |
| \`fill-offer\` | \`id, shares\` | you send exactly \`cost-of(shares, price)\` |
| \`cancel-offer\` | \`id\` | none |
| \`post-bid\` | \`legion, side, shares, price\` | you send exactly \`cost-of(shares, price)\` |
| \`fill-bid\` | \`id, shares\` | exchange sends exactly \`cost-of(shares, price)\` |
| \`cancel-bid\` | \`id\` | exchange sends exactly the remaining escrow |
| \`transfer-shares\` | \`legion, side, to, amount\` | none |
| \`resolve-bonded\` | 13 proof arguments, below | none |
| \`resolve-idle\` | \`legion\` | none |
| \`resolve-meta\` | none | none |
| \`redeem\` | \`legion\` | exchange sends exactly \`claimable(legion, you)\` |

## Five ways to participate

**Ask a question.** \`create-legion(label, scripts, deadline)\`. Pick the
addresses, convert and sort them, and set a deadline at least 144 blocks out.
Creating costs nothing but the fee, and creates no position: mint and quote if
you want the market to exist. Check \`get-legion-by-terms\` first, or you will
pay a fee to learn the question already exists.

**Take a position.** \`mint-set(legion, n)\` locks \`n\` sats and hands you \`n\` YES
and \`n\` NO. Sell the side you disbelieve on the book and you are left long the
other at whatever the book paid. \`merge-set\` is the reverse and always works,
even after trading closes, so you can always get out.

**Make a market.** \`post-offer\` escrows shares, \`post-bid\` escrows sats,
\`fill-offer\` and \`fill-bid\` take the other side. Every fill pays 2% from the
maker's side. You cannot trade with yourself (\`u110\`), and both sides of a fill
count toward the bar.

**Settle YES with a proof.** Permissionless, and the highest-value action here.
\`resolve-bonded\` takes thirteen arguments: the pox-5 bond, the lockup
transaction and its merkle path against a block header, and the funding
transaction proving the lockup spends a coin paid to one of the legion's
scripts. Nobody types those. The builder prints them from public data:

\`\`\`
node scripts/build-proof.mjs <exchange-contract-id> <legion-id> [--staker SP... | --stacks-tx 0x...]
\`\`\`

With neither flag it scans the newest pox-5 bonds, which is what a watcher
wants. It recomputes the merkle root and checks it against the header before
printing, so a proof it prints is one the contract accepts. The bond must be
mined **after** the legion was created (\`u210\`) and **by** its deadline
(\`u129\`), and the proof must land within the grace (\`u128\`). The contract reads
the staker's pox-5 membership at submission time, so submit promptly.

**Settle NO by waiting.** \`resolve-idle(legion)\` needs no evidence, only that
the grace has passed with no proof. Permissionless. If you hold NO, this is the
call that turns your shares into sats; nobody is obliged to make it for you.

Then \`redeem(legion)\` pays the winning side one sat per share, and
\`resolve-meta()\` settles legion 0 from the scoreboard once burn 993,888 passes.

## What the meta legion counts

A legion counts for an epoch when it has traded \`50,000\` sats among \`3\`
distinct traders in it. The count per epoch is \`get-qualified-count(epoch)\`, and
\`meta-count()\` is the lowest across epochs 490, 491 and 492, because the bar has
to be cleared in **each** of them.

Three rules keep the count honest, and they shape what is worth doing:

- **The meta legion's own trading never counts.** It cannot bootstrap itself.
- **Any fill touching the fee sink never counts**, volume and trader both. A bar
  the bootstrapper can satisfy alone is not a bar.
- **Only volume counts, never collateral.** Minting and merging are free round
  trips, so money sitting still buys nothing here.

That last one is the whole security argument, and it is arithmetic:

\`\`\`
cost to force YES  ~=  3 x 50 legions x 50,000 sats x 2%  =  150,000 sats
\`\`\`

unrecoverable, because it is all fees. So the meta market is sound only while
its own open interest stays well under that, which is why legion 0 is capped at
\`50,000\` sats of collateral (\`u127\` over it). Check the room before minting.

**A legion only counts if it is still trading through the last counted epoch.**
Trading stops at the deadline, so a legion whose deadline is before burn
\`993,887\` can never contribute to the count, whatever it trades. When you create
one and you want it to count, set the deadline past that.

## Errors worth handling

| Code | Means |
| --- | --- |
| \`u101\` | no such legion |
| \`u102\` | already settled |
| \`u104\` | not enough shares |
| \`u105\` | price outside 1..10000 |
| \`u106\` | trade under the 1,000 sat minimum |
| \`u107\` \`u108\` | no such order, or it is already done |
| \`u109\` \`u110\` | not your order; cannot trade with yourself |
| \`u111\` | more than the order has left |
| \`u113\` | too early: NO before the grace ends, meta before its close |
| \`u115\` \`u116\` | not settled yet; nothing to claim |
| \`u117\` \`u126\` | deadline sooner than 144 blocks, or further than a year |
| \`u125\` | trading closed, the deadline passed |
| \`u127\` | the meta legion is at its 50,000 sat cap |
| \`u128\` | the proof arrived after the grace |
| \`u129\` \`u210\` | the bond was mined after the deadline, or before the legion existed |
| \`u130\` | this exact question already exists |
| \`u131\` \`u132\` \`u133\` | no scripts, an empty one, or not sorted and unique |
| \`u206\` \`u211\` | the staker has no pox-5 membership, or no such bond |
| \`u207\` | an sBTC bond, not a Bitcoin one |
| \`u214\` | the coin was not paid to one of the legion's addresses |
| \`u200\` \`u201\` \`u300\` \`u313\` | bad header, merkle path, parse, or not a pox-5 lockup |

\`u133\` and \`u130\` are the two that catch everyone writing a creator: sort the
scripts, and check \`get-legion-by-terms\` first.

## Practice

**The asymmetry is the point.** YES has a terminal action anyone can take: find
the bond, build the proof, end the market. NO wins by nothing happening, so the
work on that side is monitoring and argument, and it pays only after the grace.
An agent that watches pox-5 for bonds against every open legion's scripts can
settle YES on legions it holds, and can buy before it submits.

**Market-making is the only way to earn without a view.** The bar needs volume
from three traders, so quoting both sides of a legion you have no opinion on is
useful and paid for in spread. It costs 2% per fill, taken from the maker.

**A legion nobody trades is worth nothing to the meta legion.** Creating five
hundred of them changes the score by zero. Fifty that actually trade, in each of
three consecutive epochs, is the whole question.
`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
