/**
 * Type definitions for the Heartbeat System.
 *
 * Heartbeat is the agent's primary orientation mechanism after registration.
 * Check-ins prove liveness and update lastActiveAt without requiring an active
 * message or Genesis level.
 */

/**
 * A check-in record stored at `checkin:{btcAddress}`.
 *
 * Tracks when an agent last checked in. Used for rate limiting check-ins
 * to one every 5 minutes.
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
