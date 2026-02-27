/**
 * Challenge/Response system for agent profile updates.
 *
 * Agents request a time-bound challenge, sign it with their key, and submit
 * to prove ownership and execute an action (e.g., update description).
 */

import type { AgentRecord } from "@/lib/types";
import { validateNostrPubkey } from "@/lib/nostr";

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
  (params: Record<string, unknown>, agent: AgentRecord, kv: KVNamespace): Promise<ActionResult>;
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
 * Validate a taproot Bitcoin address (bc1p... Bech32m format).
 */
export function validateTaprootAddress(address: string): boolean {
  // Taproot addresses are Bech32m encoded, starting with bc1p
  // P2TR mainnet addresses are always exactly 62 characters: "bc1p" (4) + 58 data chars
  return /^bc1p[a-z0-9]{58}$/.test(address);
}

/**
 * Action handler: update-taproot
 */
async function handleUpdateTaproot(
  params: Record<string, unknown>,
  agent: AgentRecord,
  kv: KVNamespace
): Promise<ActionResult> {
  const taprootAddress = params.taprootAddress as string | undefined;

  if (taprootAddress === undefined) {
    return {
      success: false,
      updated: agent,
      error: "Missing required parameter: taprootAddress",
    };
  }

  const trimmed = taprootAddress.trim();

  if (trimmed.length === 0) {
    // Allow clearing taproot address
    if (agent.taprootAddress) {
      await kv.delete(`taproot:${agent.taprootAddress}`);
    }
    const updated: AgentRecord = {
      ...agent,
      taprootAddress: null,
    };
    return { success: true, updated };
  }

  if (!validateTaprootAddress(trimmed)) {
    return {
      success: false,
      updated: agent,
      error: "Invalid taproot address. Must start with bc1p (Bech32m format).",
    };
  }

  // Check if this taproot address is already claimed by a different agent
  const existingOwner = await kv.get(`taproot:${trimmed}`);
  if (existingOwner && existingOwner !== agent.btcAddress) {
    return {
      success: false,
      updated: agent,
      error: "This taproot address is already claimed by another agent.",
    };
  }

  // Clean up old reverse index if taproot address is changing
  if (agent.taprootAddress && agent.taprootAddress !== trimmed) {
    await kv.delete(`taproot:${agent.taprootAddress}`);
  }

  // Set new reverse index: taproot:{taprootAddress} -> btcAddress
  await kv.put(`taproot:${trimmed}`, agent.btcAddress);

  const updated: AgentRecord = {
    ...agent,
    taprootAddress: trimmed,
  };

  return { success: true, updated };
}

/**
 * Action handler: update-description
 */
async function handleUpdateDescription(
  params: Record<string, unknown>,
  agent: AgentRecord,
  _kv: KVNamespace
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
 * Action handler: update-owner
 */
async function handleUpdateOwner(
  params: Record<string, unknown>,
  agent: AgentRecord,
  kv: KVNamespace
): Promise<ActionResult> {
  const owner = params.owner as string | undefined;

  if (owner === undefined) {
    return {
      success: false,
      updated: agent,
      error: "Missing required parameter: owner",
    };
  }

  const trimmed = owner.trim();
  const oldOwner = agent.owner || null;

  // Allow empty string to clear owner
  if (trimmed.length === 0) {
    // Clean up old reverse index
    if (oldOwner) {
      await kv.delete(`owner:${oldOwner.toLowerCase()}`);
    }
    const updated: AgentRecord = {
      ...agent,
      owner: null,
    };
    return {
      success: true,
      updated,
    };
  }

  if (trimmed.length > 15) {
    return {
      success: false,
      updated: agent,
      error: "X handle must be 15 characters or less",
    };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return {
      success: false,
      updated: agent,
      error: "X handle can only contain letters, numbers, and underscores",
    };
  }

  // Check if this handle is already claimed by a different agent
  const existingOwner = await kv.get(`owner:${trimmed.toLowerCase()}`);
  if (existingOwner && existingOwner !== agent.btcAddress) {
    return {
      success: false,
      updated: agent,
      error: "This X handle is already claimed by another agent. Each handle can only belong to one agent.",
    };
  }

  // Clean up old reverse index if handle is changing
  if (oldOwner && oldOwner.toLowerCase() !== trimmed.toLowerCase()) {
    await kv.delete(`owner:${oldOwner.toLowerCase()}`);
  }

  // Set new reverse index
  await kv.put(`owner:${trimmed.toLowerCase()}`, agent.btcAddress);

  const updated: AgentRecord = {
    ...agent,
    owner: trimmed,
  };

  return {
    success: true,
    updated,
  };
}

/**
 * Action handler: update-nostr-pubkey
 */
async function handleUpdateNostrPubkey(
  params: Record<string, unknown>,
  agent: AgentRecord,
  _kv: KVNamespace
): Promise<ActionResult> {
  const nostrPublicKey = params.nostrPublicKey as string | undefined;

  if (nostrPublicKey === undefined) {
    return {
      success: false,
      updated: agent,
      error: "Missing required parameter: nostrPublicKey",
    };
  }

  const trimmed = nostrPublicKey.trim().toLowerCase();

  // Allow empty string to clear nostr public key
  if (trimmed.length === 0) {
    const updated: AgentRecord = {
      ...agent,
      nostrPublicKey: null,
    };
    return { success: true, updated };
  }

  if (!validateNostrPubkey(trimmed)) {
    return {
      success: false,
      updated: agent,
      error: "Invalid nostrPublicKey. Must be a 64-character lowercase hex string (x-only secp256k1 pubkey).",
    };
  }

  const updated: AgentRecord = {
    ...agent,
    nostrPublicKey: trimmed,
  };

  return { success: true, updated };
}

/**
 * Action router: maps action names to handlers.
 */
const ACTION_HANDLERS: Record<string, ActionHandler> = {
  "update-description": handleUpdateDescription,
  "update-owner": handleUpdateOwner,
  "update-taproot": handleUpdateTaproot,
  "update-nostr-pubkey": handleUpdateNostrPubkey,
};

/**
 * Execute an action via the action router.
 */
export async function executeAction(
  action: string,
  params: Record<string, unknown>,
  agent: AgentRecord,
  kv: KVNamespace
): Promise<ActionResult> {
  const handler = ACTION_HANDLERS[action];

  if (!handler) {
    return {
      success: false,
      updated: agent,
      error: `Unknown action: ${action}`,
    };
  }

  return handler(params, agent, kv);
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
    {
      name: "update-owner",
      description: "Update your X handle",
      params: {
        owner: {
          type: "string",
          required: true,
          description: "X handle (1-15 chars, alphanumeric + underscore)",
        },
      },
    },
    {
      name: "update-taproot",
      description: "Add or update your taproot Bitcoin address (bc1p...)",
      params: {
        taprootAddress: {
          type: "string",
          required: true,
          description: "Taproot address (bc1p... Bech32m format, or empty string to clear)",
        },
      },
    },
    {
      name: "update-nostr-pubkey",
      description: "Set or update your Nostr public key (x-only secp256k1, NIP-19 compatible)",
      params: {
        nostrPublicKey: {
          type: "string",
          required: true,
          description: "64-character lowercase hex string (x-only secp256k1 pubkey), or empty string to clear",
        },
      },
    },
  ];
}
