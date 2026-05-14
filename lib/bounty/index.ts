/**
 * Bounty system — barrel export.
 *
 * D1 is the sole source of truth. Status is derived from timestamps via
 * `bountyStatus()`. See `lib/bounty/types.ts` and PLAN.md.
 */

export type {
  BountyStatus,
  BountyRecord,
  BountySubmission,
  BountyWinner,
  BountyPaymentHint,
} from "./types";
export { bountyStatus } from "./types";

export {
  TITLE_MAX,
  DESCRIPTION_MAX,
  SUBMISSION_MESSAGE_MAX,
  SUBMISSION_URL_MAX,
  TAGS_MAX,
  TAG_LENGTH_MAX,
  MIN_EXPIRY_HOURS,
  MAX_EXPIRY_DAYS,
  MIN_POSTER_LEVEL,
  MIN_SUBMITTER_LEVEL,
  SIGNATURE_WINDOW_SECONDS,
  ACCEPT_GRACE_MS,
  PAY_GRACE_MS,
  MEMO_PREFIX,
  SBTC_CONTRACTS,
  SBTC_CONTRACT_MAINNET,
  KV_PREFIXES,
  PAID_TXID_TTL_SECONDS,
  SIGNATURE_MESSAGE_FORMATS,
} from "./constants";

export {
  canonicalJSON,
  bodyHash,
  buildCreateMessage,
  buildSubmitMessage,
  buildAcceptMessage,
  buildPaidMessage,
  buildCancelMessage,
  isWithinSignatureWindow,
} from "./signatures";

export type { ValidationHint } from "./validation";
export {
  validateCreateBounty,
  validateSubmit,
  validateAccept,
  validatePaid,
  validateCancel,
} from "./validation";

export type { ListBountiesFilters, ListBountiesResult, ListSubmissionsResult } from "./d1-helpers";
export {
  statusToSql,
  getBounty,
  listBounties,
  insertBounty,
  setAccepted,
  setPaid,
  setCancelled,
  getSubmission,
  listSubmissionsForBounty,
  listSubmissionsBySubmitter,
  insertSubmission,
  hasSubmission,
} from "./d1-helpers";

export { isTxidRedeemed, reserveTxid } from "./kv-helpers";

export { generateBountyId, generateSubmissionId } from "./id";

export type { TxidVerifyFailureCode, TxidVerifyResult } from "./txid-verify";
export { buildExpectedMemo, verifyPayoutTxid } from "./txid-verify";
