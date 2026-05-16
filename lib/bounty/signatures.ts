/**
 * Signed message builders for bounty actions.
 *
 * Each POST endpoint accepts a Bitcoin signature (BIP-137/322) over one of
 * the templates below. The full body content is included in the signed
 * message — same pattern as `/api/outbox` and other signed-action endpoints
 * in this codebase — so any tampering with the body breaks the signature.
 *
 * Verification: route handlers call `verifyBitcoinSignature()` from
 * `lib/bitcoin-verify.ts` with the rebuilt message and the body's stated
 * `posterBtcAddress` / `submitterBtcAddress`, then check the recovered
 * address matches and `signedAt` is within `SIGNATURE_WINDOW_SECONDS`.
 */

import { SIGNATURE_MESSAGE_FORMATS } from "./constants";

/** Join tags with commas; empty string when no tags. */
function joinTags(tags: string[] | undefined): string {
  return Array.isArray(tags) ? tags.join(",") : "";
}

/**
 * Build the message a poster signs to create a bounty.
 *
 * All body fields are included in the signed message so the signature is
 * bound to the exact bounty content.
 */
export function buildCreateMessage(params: {
  posterBtcAddress: string;
  title: string;
  description: string;
  rewardSats: number;
  expiresAt: string;
  tags?: string[];
  signedAt: string;
}): string {
  return SIGNATURE_MESSAGE_FORMATS.CREATE
    .replace("{posterBtc}", params.posterBtcAddress)
    .replace("{title}", params.title)
    .replace("{description}", params.description)
    .replace("{rewardSats}", String(params.rewardSats))
    .replace("{expiresAt}", params.expiresAt)
    .replace("{tags}", joinTags(params.tags))
    .replace("{signedAt}", params.signedAt);
}

/**
 * Build the message a submitter signs to submit work to a bounty.
 *
 * Full submission body is included — `contentUrl` is empty string when
 * omitted.
 */
export function buildSubmitMessage(params: {
  bountyId: string;
  submitterBtcAddress: string;
  message: string;
  contentUrl?: string;
  signedAt: string;
}): string {
  return SIGNATURE_MESSAGE_FORMATS.SUBMIT
    .replace("{bountyId}", params.bountyId)
    .replace("{submitterBtc}", params.submitterBtcAddress)
    .replace("{message}", params.message)
    .replace("{contentUrl}", params.contentUrl ?? "")
    .replace("{signedAt}", params.signedAt);
}

/** Build the message a poster signs to accept a submission. */
export function buildAcceptMessage(params: {
  bountyId: string;
  submissionId: string;
  signedAt: string;
}): string {
  return SIGNATURE_MESSAGE_FORMATS.ACCEPT
    .replace("{bountyId}", params.bountyId)
    .replace("{submissionId}", params.submissionId)
    .replace("{signedAt}", params.signedAt);
}

/** Build the message a poster signs to prove payment. */
export function buildPaidMessage(params: {
  bountyId: string;
  txid: string;
  signedAt: string;
}): string {
  return SIGNATURE_MESSAGE_FORMATS.PAID
    .replace("{bountyId}", params.bountyId)
    .replace("{txid}", params.txid)
    .replace("{signedAt}", params.signedAt);
}

/** Build the message a poster signs to cancel a bounty. */
export function buildCancelMessage(params: {
  bountyId: string;
  signedAt: string;
}): string {
  return SIGNATURE_MESSAGE_FORMATS.CANCEL
    .replace("{bountyId}", params.bountyId)
    .replace("{signedAt}", params.signedAt);
}

/**
 * Check whether a signed-at ISO timestamp is within the replay window.
 *
 * Returns true when `|now - signedAt| <= windowSeconds`.
 */
export function isWithinSignatureWindow(
  signedAt: string,
  windowSeconds: number,
  now: Date = new Date()
): boolean {
  const t = Date.parse(signedAt);
  if (Number.isNaN(t)) return false;
  return Math.abs(now.getTime() - t) <= windowSeconds * 1000;
}
