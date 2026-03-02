/**
 * Vouch (Referral) System - Barrel export.
 */

// Types
export type { VouchRecord, VouchAgentIndex, ReferralCodeRecord } from "./types";

// Constants
export { MIN_REFERRER_LEVEL, MAX_REFERRALS, KV_PREFIXES } from "./constants";

// KV Helpers
export {
  getVouchRecord,
  storeVouch,
  getVouchIndex,
  getVouchRecordsByReferrer,
  storeReferralCode,
  getReferralCode,
  lookupReferralCode,
  deleteReferralLookup,
  getReferralCount,
  generateAndStoreReferralCode,
} from "./kv-helpers";
