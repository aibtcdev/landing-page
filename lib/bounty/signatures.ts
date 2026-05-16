/**
 * Signed message builders for bounty actions.
 *
 * Each POST endpoint accepts a Bitcoin signature (BIP-137/322) over one of
 * the templates below. The body content is bound to the signature via
 * `bodyHash` (sha256 of the canonical JSON of the payload), so the signature
 * cannot be reused with a modified body.
 *
 * Verification: route handlers call `verifyBitcoinSignature()` from
 * `lib/bitcoin-verify.ts` with the rebuilt message and the body's stated
 * `posterBtcAddress` / `submitterBtcAddress`, then check the recovered
 * address matches and `signedAt` is within `SIGNATURE_WINDOW_SECONDS`.
 */

import { hashSha256Sync } from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import { SIGNATURE_MESSAGE_FORMATS } from "./constants";

/**
 * Canonical JSON for hashing: sorted keys, no whitespace, undefined dropped.
 *
 * Deterministic so the client and server produce the same `bodyHash` from
 * the same fields. Keep the payload simple — no nested objects, no arrays of
 * objects — and this stays predictable.
 */
export function canonicalJSON(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    const v = payload[k];
    if (v === undefined) continue;
    out[k] = v;
  }
  return JSON.stringify(out);
}

/** sha256 of canonical JSON, returned as lowercase hex. */
export function bodyHash(payload: Record<string, unknown>): string {
  return bytesToHex(hashSha256Sync(new TextEncoder().encode(canonicalJSON(payload))));
}

/**
 * Build the message a poster signs to create a bounty.
 *
 * Fields signed via bodyHash: title, description, rewardSats, expiresAt, tags.
 */
export function buildCreateMessage(params: {
  posterBtcAddress: string;
  bodyHash: string;
  signedAt: string;
}): string {
  return SIGNATURE_MESSAGE_FORMATS.CREATE
    .replace("{posterBtc}", params.posterBtcAddress)
    .replace("{bodyHash}", params.bodyHash)
    .replace("{signedAt}", params.signedAt);
}

/**
 * Build the message a submitter signs to submit work to a bounty.
 *
 * Fields signed via bodyHash: message, contentUrl.
 */
export function buildSubmitMessage(params: {
  bountyId: string;
  submitterBtcAddress: string;
  bodyHash: string;
  signedAt: string;
}): string {
  return SIGNATURE_MESSAGE_FORMATS.SUBMIT
    .replace("{bountyId}", params.bountyId)
    .replace("{submitterBtc}", params.submitterBtcAddress)
    .replace("{bodyHash}", params.bodyHash)
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
