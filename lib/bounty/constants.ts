/**
 * Constants for the AIBTC Bounty System.
 *
 * Grace windows and limits are tuned for the no-escrow trust model: the
 * poster keeps full control of payment, and these windows define how long
 * before the system flips an inactive bounty to `abandoned`.
 */

/** Max characters in a bounty title. */
export const TITLE_MAX = 120;

/** Max characters in a bounty description. */
export const DESCRIPTION_MAX = 4000;

/** Max characters in a submission message. */
export const SUBMISSION_MESSAGE_MAX = 2000;

/** Max URL length for `contentUrl` on a submission. */
export const SUBMISSION_URL_MAX = 500;

/** Max number of tags per bounty. */
export const TAGS_MAX = 5;

/** Max characters per tag. */
export const TAG_LENGTH_MAX = 24;

/** Minimum expiry — 1 hour from now. */
export const MIN_EXPIRY_HOURS = 1;

/** Maximum expiry — 365 days from now. */
export const MAX_EXPIRY_DAYS = 365;

/** Minimum participant level (Registered). Applies to both posters and submitters. */
export const MIN_SUBMITTER_LEVEL = 1;

/** Maximum winners per bounty. Prevents accidental overflow. */
export const MAX_WINNERS = 10;

/** Replay window for action signatures (±5 minutes). */
export const SIGNATURE_WINDOW_SECONDS = 300;

/**
 * Accept-grace window after `expiresAt`. If the poster never picks a winner
 * within this window, the bounty's derived status flips to `abandoned`.
 */
export const ACCEPT_GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Pay-grace window after `acceptedAt`. If the poster accepts but never proves
 * payment within this window, the bounty's derived status flips to `abandoned`.
 */
export const PAY_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * SIP-010 memo prefix used to bind an on-chain sBTC transfer to a specific
 * bounty. The full memo is `BNTY:` + `bountyId` (26-char ulid).
 *
 * Total = 5 + 26 = 31 bytes, fits in the SIP-010 `(buff 34)` memo field.
 */
export const MEMO_PREFIX = "BNTY:";

/** sBTC token contracts per network. Mirrors `lib/inbox/constants.ts`. */
export const SBTC_CONTRACTS = {
  mainnet: {
    address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
    name: "sbtc-token",
  },
  testnet: {
    address: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT",
    name: "sbtc-token",
  },
} as const;

/** Default action signatures use mainnet sBTC. */
export const SBTC_CONTRACT_MAINNET = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.name}`;

/** KV key prefixes — txid uniqueness only. No record mirror, no pending cache. */
export const KV_PREFIXES = {
  /** `bounty:paid-txid:{txid}` → bountyId. One txid can pay one bounty. */
  PAID_TXID: "bounty:paid-txid:",
} as const;

/** TTL for the paid-txid uniqueness reservation (365 days). */
export const PAID_TXID_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Signed-message templates. Build via `lib/bounty/signatures.ts`. */
export const SIGNATURE_MESSAGE_FORMATS = {
  CREATE:
    "AIBTC Bounty Create | {posterBtc} | {title} | {description} | {rewardSats} | {expiresAt} | {tags} | {signedAt}",
  SUBMIT:
    "AIBTC Bounty Submit | {bountyId} | {submitterBtc} | {message} | {contentUrl} | {signedAt}",
  ACCEPT: "AIBTC Bounty Accept | {bountyId} | {submissionId} | {signedAt}",
  PAID: "AIBTC Bounty Paid | {bountyId} | {txid} | {signedAt}",
  CANCEL: "AIBTC Bounty Cancel | {bountyId} | {signedAt}",
} as const;

// Hiro API base is sourced from lib/identity/constants.ts → STACKS_API_BASE
// (mainnet) / STACKS_API_TESTNET_BASE (testnet). The canonical helper
// `stacksApiFetch()` from lib/stacks-api-fetch.ts handles retries +
// rate-limit observability. Do not hardcode Hiro URLs here.
