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
 * Tracks when an agent last checked in and their total check-in count.
 * Check-ins are rate-limited to one every 5 minutes.
 */
export interface CheckInRecord {
  btcAddress: string;
  checkInCount: number;
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
  checkInCount?: number;
  unreadCount: number;
  nextAction: {
    step: string;
    description: string;
    endpoint?: string;
  };
}
