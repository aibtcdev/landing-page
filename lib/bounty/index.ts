/**
 * Bounty system — barrel export.
 *
 * D1 is the sole source of truth. Status is derived from timestamps via
 * `bountyStatus()`. See `lib/bounty/types.ts`.
 */

export type {
  BountyStatus,
  BountyRecord,
  BountySubmission,
  BountyWinner,
  BountyPaymentHint,
  BountyTeamMember,
  BountyPayout,
} from "./types";
export { bountyStatus, splitReward } from "./types";

export {
  TITLE_MAX,
  DESCRIPTION_MAX,
  SUBMISSION_MESSAGE_MAX,
  SUBMISSION_URL_MAX,
  TAGS_MAX,
  TAG_LENGTH_MAX,
  MIN_EXPIRY_HOURS,
  MAX_EXPIRY_DAYS,
  MIN_SUBMITTER_LEVEL,
  SIGNATURE_WINDOW_SECONDS,
  ACCEPT_GRACE_MS,
  PAY_GRACE_MS,
  MEMO_PREFIX,
  DETAIL_SUBMISSIONS_PAGE,
  SBTC_CONTRACTS,
  SBTC_CONTRACT_MAINNET,
  SIGNATURE_MESSAGE_FORMATS,
  TEAM_MAX,
} from "./constants";

export {
  buildCreateMessage,
  buildSubmitMessage,
  buildAcceptMessage,
  buildPaidMessage,
  buildCancelMessage,
  buildTeamConfirmMessage,
  buildTeamRemoveMessage,
  isWithinSignatureWindow,
} from "./signatures";

export type { ValidationHint } from "./validation";
export {
  validateCreateBounty,
  validateSubmit,
  validateAccept,
  validatePaid,
  validateCancel,
  validateTeamConfirm,
  validateTeamRemove,
} from "./validation";

export type {
  ListBountiesFilters,
  ListBountiesResult,
  ListSubmissionsResult,
  SubmitAttemptCounts,
  SubmitAttemptOutcome,
  PendingTeamConfirm,
} from "./d1-helpers";
export {
  statusToSql,
  getBounty,
  listBounties,
  insertBounty,
  setAccepted,
  recordMemberPayments,
  setCancelled,
  getSubmission,
  listSubmissionsForBounty,
  listSubmissionsBySubmitter,
  insertSubmission,
  enteredAgents,
  ensureLeadMember,
  listMembers,
  withTeams,
  teamState,
  confirmMember,
  removePendingMember,
  dropUnconfirmableInvites,
  isOneEntryConflict,
  isPaidTransferConflict,
  buildPayout,
  listPendingConfirms,
  submittedBountyIds,
  recordSubmitAttempt,
  getSubmitAttemptCounts,
} from "./d1-helpers";

export { generateBountyId, generateSubmissionId } from "./id";

export type { TxidVerifyFailureCode, TxidVerifyResult, PayoutRecipient } from "./txid-verify";
export { buildExpectedMemo, verifyPayoutTxid } from "./txid-verify";
