/**
 * ERC-8004 Identity and Reputation types
 */

/**
 * Discriminated result returned by reputation fetch helpers.
 *
 * - `transient: false` — authoritative result (on-chain success or confirmed
 *   empty). Safe to persist in a long-lived edge cache or per-agent KV entry.
 * - `transient: true` — fallback produced when the circuit breaker is open or
 *   a Hiro call fails. Value is a safe empty shape, but it MUST NOT be
 *   edge-cached as if it were an authoritative result. Routes should bypass
 *   `withEdgeCache` and set `Cache-Control: no-store` for these responses.
 */
export type ReputationResult<T> =
  | { transient: false; value: T }
  | { transient: true; value: T };

export interface AgentIdentity {
  agentId: number;
  owner: string;
  uri: string;
  registeredAt?: string;
}

export interface ReputationSummary {
  count: number;
  summaryValue: number; // Converted from WAD (18-decimal) format
  summaryValueDecimals: number; // Always 18 for WAD
}

export interface ReputationFeedback {
  client: string;
  clientDisplayName?: string;
  clientBtcAddress?: string;
  index: number;
  value: number;
  valueDecimals: number;
  wadValue: number; // WAD-normalized value (18 decimals)
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

export interface ReputationFeedbackResponse {
  items: ReputationFeedback[];
  cursor: number | null;
}
