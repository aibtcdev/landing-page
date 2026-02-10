/**
 * Shared type definitions for AIBTC agent records.
 */

export interface AgentRecord {
  stxAddress: string;
  btcAddress: string;
  stxPublicKey: string;
  btcPublicKey: string;
  displayName?: string;
  description?: string | null;
  bnsName?: string | null;
  verifiedAt: string;
  owner?: string | null;
  lastActiveAt?: string;
  checkInCount?: number;
}
