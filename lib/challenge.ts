/**
 * Challenge/Response system for agent profile updates.
 *
 * Agents request a time-bound challenge, sign it with their key, and submit
 * to prove ownership and execute an action (e.g., update description).
 */

import type { AgentRecord } from "@/lib/types";

export interface Challenge {
  message: string;
  expiresAt: string;
  action: string;
}

export interface ChallengeStoreRecord extends Challenge {
  createdAt: string;
}

export interface ActionResult {
  success: boolean;
  updated: AgentRecord;
  error?: string;
}

export interface ActionHandler {
  (params: Record<string, unknown>, agent: AgentRecord): Promise<ActionResult>;
}

/**
 * Generate a challenge message for an address and action.
 */
export function generateChallenge(address: string, action: string): Challenge {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

  const message = `Challenge: ${action} for ${address} at ${now.toISOString()}`;

  return {
    message,
    expiresAt: expiresAt.toISOString(),
    action,
  };
}

/**
 * Store a challenge in KV with TTL.
 */
export async function storeChallenge(
  kv: KVNamespace,
  address: string,
  challenge: Challenge
): Promise<void> {
  const record: ChallengeStoreRecord = {
    ...challenge,
    createdAt: new Date().toISOString(),
  };

  // TTL of 1800 seconds (30 minutes)
  await kv.put(
    `challenge:${address}`,
    JSON.stringify(record),
    { expirationTtl: 1800 }
  );
}

/**
 * Get a challenge from KV by address.
 */
export async function getChallenge(
  kv: KVNamespace,
  address: string
): Promise<ChallengeStoreRecord | null> {
  const value = await kv.get(`challenge:${address}`);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as ChallengeStoreRecord;
  } catch {
    return null;
  }
}

/**
 * Delete a challenge from KV (single-use pattern).
 */
export async function deleteChallenge(
  kv: KVNamespace,
  address: string
): Promise<void> {
  await kv.delete(`challenge:${address}`);
}

/**
 * Validate that the challenge message matches expected format and hasn't expired.
 */
export function validateChallenge(
  storedChallenge: ChallengeStoreRecord,
  submittedMessage: string
): { valid: boolean; reason?: string } {
  // Check if expired
  const now = new Date();
  const expiresAt = new Date(storedChallenge.expiresAt);

  if (now > expiresAt) {
    return { valid: false, reason: "Challenge expired" };
  }

  // Check if message matches
  if (storedChallenge.message !== submittedMessage) {
    return { valid: false, reason: "Challenge message mismatch" };
  }

  return { valid: true };
}

/**
 * Rate limiting: check if IP has exceeded rate limit.
 * Limit: 6 requests per 10 minutes.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const key = `rate:challenge:${ip}`;
  const value = await kv.get(key);

  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxRequests = 6;

  let timestamps: number[] = [];

  if (value) {
    try {
      timestamps = JSON.parse(value) as number[];
      // Filter out timestamps outside the window
      timestamps = timestamps.filter(ts => now - ts < windowMs);
    } catch {
      timestamps = [];
    }
  }

  if (timestamps.length >= maxRequests) {
    // Rate limited
    const oldestTimestamp = Math.min(...timestamps);
    const retryAfterMs = windowMs - (now - oldestTimestamp);
    return {
      allowed: false,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    };
  }

  return { allowed: true };
}

/**
 * Record a request for rate limiting.
 */
export async function recordRequest(
  kv: KVNamespace,
  ip: string
): Promise<void> {
  const key = `rate:challenge:${ip}`;
  const value = await kv.get(key);

  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes

  let timestamps: number[] = [];

  if (value) {
    try {
      timestamps = JSON.parse(value) as number[];
      // Filter out timestamps outside the window
      timestamps = timestamps.filter(ts => now - ts < windowMs);
    } catch {
      timestamps = [];
    }
  }

  timestamps.push(now);

  // Store with TTL slightly longer than window to avoid orphaned keys
  await kv.put(key, JSON.stringify(timestamps), {
    expirationTtl: Math.ceil(windowMs / 1000) + 60,
  });
}

/**
 * Action handler: update-description
 */
async function handleUpdateDescription(
  params: Record<string, unknown>,
  agent: AgentRecord
): Promise<ActionResult> {
  const description = params.description as string | undefined;

  if (description === undefined) {
    return {
      success: false,
      updated: agent,
      error: "Missing required parameter: description",
    };
  }

  const trimmed = description.trim();

  if (trimmed.length > 280) {
    return {
      success: false,
      updated: agent,
      error: "Description must be 280 characters or less",
    };
  }

  const updated: AgentRecord = {
    ...agent,
    description: trimmed || null,
  };

  return {
    success: true,
    updated,
  };
}

/**
 * Action router: maps action names to handlers.
 */
const ACTION_HANDLERS: Record<string, ActionHandler> = {
  "update-description": handleUpdateDescription,
};

/**
 * Execute an action via the action router.
 */
export async function executeAction(
  action: string,
  params: Record<string, unknown>,
  agent: AgentRecord
): Promise<ActionResult> {
  const handler = ACTION_HANDLERS[action];

  if (!handler) {
    return {
      success: false,
      updated: agent,
      error: `Unknown action: ${action}`,
    };
  }

  return handler(params, agent);
}

/**
 * Get list of available actions.
 */
export function getAvailableActions(): Array<{
  name: string;
  description: string;
  params: Record<string, { type: string; required: boolean; description: string }>;
}> {
  return [
    {
      name: "update-description",
      description: "Update your agent description",
      params: {
        description: {
          type: "string",
          required: true,
          description: "New description (max 280 characters)",
        },
      },
    },
  ];
}
