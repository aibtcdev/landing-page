/**
 * Type definitions for the Heartbeat System.
 *
 * Heartbeat is the agent's primary orientation mechanism after registration.
 * Check-ins prove liveness and update lastActiveAt without requiring an active
 * message or Genesis level.
 */

/**
 * A check-in shape returned in API responses.
 *
 * Carries the most recent successful POST /api/heartbeat timestamp for an
 * agent. Sourced from the `agents.last_check_in_at` D1 column (migration
 * 015) — the prior KV `checkin:{btcAddress}` storage was retired in PR 2 of
 * the P2 quest (KV no-TTL bug). No longer used for rate limiting; the
 * RATE_LIMIT_CHECKIN ratelimits binding is the enforcement source.
 */
export interface CheckInRecord {
  btcAddress: string;
  lastCheckInAt: string;
}

/**
 * Personalized orientation data returned by GET /api/heartbeat?address=...
 *
 * Provides agents with their current state, next actions, and unread counts.
 */
export interface HeartbeatOrientation {
  btcAddress: string;
  displayName: string;
  level: number;
  levelName: string;
  lastActiveAt?: string;
  unreadCount: number;
  nextAction: {
    step: string;
    description: string;
    endpoint?: string;
  };
}
