/**
 * Challenge/Response system for agent profile updates.
 *
 * Agents request a time-bound challenge, sign it with their key, and submit
 * to prove ownership and execute an action (e.g., update description).
 */

import type { AgentRecord } from "@/lib/types";
import { validateNostrPubkey } from "@/lib/nostr";
import { p2wpkh, p2tr, NETWORK as BTC_NETWORK } from "@scure/btc-signer";
import { hex } from "@scure/base";

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
  } catch (e) {
    console.error(`Failed to parse challenge for ${address}:`, e);
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
  const nostrPublicKey = params.nostrPublicKey;

  if (nostrPublicKey === undefined) {
    return {
      success: false,
      updated: agent,
      error: "Missing required parameter: nostrPublicKey",
    };
  }

  if (typeof nostrPublicKey !== "string") {
    return {
      success: false,
      updated: agent,
      error: "Invalid type for nostrPublicKey. Expected string.",
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
 * Validate a GitHub username.
 * Rules: 1-39 chars, [a-zA-Z0-9-], no leading/trailing hyphens.
 */
export function validateGitHubUsername(username: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username);
}

/**
 * Extract gist ID from a GitHub Gist URL.
 * Accepts: https://gist.github.com/{user}/{gistId}
 * Returns the last path segment (the gist ID).
 */
export function extractGistId(gistUrl: string): string | null {
  try {
    const url = new URL(gistUrl);
    if (url.hostname !== "gist.github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // pathname is /{user}/{gistId} — gistId is the last segment
    if (parts.length < 2) return null;
    return parts[parts.length - 1];
  } catch {
    return null;
  }
}

/**
 * Action handler: link-github
 *
 * Verifies a GitHub gist challenge and links a GitHub username to an agent.
 *
 * The gist must:
 *   - Be owned by the GitHub username being claimed
 *   - Contain a file whose content includes the issued challenge string
 *
 * The BTC signature is already verified upstream by the challenge system.
 * We do NOT need to re-verify the BTC signature inside the gist — the fact
 * that the agent signed the challenge with their registered BTC key (verified
 * before executeAction is called) is sufficient proof of BTC ownership. The
 * gist just proves GitHub ownership (gist.owner.login === githubUsername).
 */
async function handleLinkGitHub(
  params: Record<string, unknown>,
  agent: AgentRecord,
  kv: KVNamespace
): Promise<ActionResult> {
  const gistUrl = params.gistUrl as string | undefined;
  const githubUsername = params.githubUsername as string | undefined;

  if (!gistUrl || !githubUsername) {
    return {
      success: false,
      updated: agent,
      error: "Missing required parameters: gistUrl, githubUsername",
    };
  }

  const trimmedUsername = githubUsername.trim();
  const trimmedGistUrl = gistUrl.trim();

  // Validate GitHub username format
  if (!validateGitHubUsername(trimmedUsername)) {
    return {
      success: false,
      updated: agent,
      error:
        "Invalid GitHub username. Must be 1-39 characters, alphanumeric and hyphens only, no leading/trailing hyphens.",
    };
  }

  // Extract gist ID from URL
  const gistId = extractGistId(trimmedGistUrl);
  if (!gistId) {
    return {
      success: false,
      updated: agent,
      error:
        "Invalid gist URL. Expected format: https://gist.github.com/{username}/{gistId}",
    };
  }

  // Fetch gist from GitHub API
  let gist: {
    owner?: { login?: string };
    files?: Record<string, { content?: string }>;
  };

  // Use GITHUB_TOKEN if available to raise rate limit from 60 to 5000 req/hr
  const githubToken = params.githubToken as string | undefined;
  const gistHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aibtcdev-landing-page",
  };
  if (githubToken) {
    gistHeaders["Authorization"] = `token ${githubToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const gistResp = await fetch(`https://api.github.com/gists/${gistId}`, {
      signal: controller.signal,
      headers: gistHeaders,
    });

    if (!gistResp.ok) {
      return {
        success: false,
        updated: agent,
        error: `Failed to fetch gist (HTTP ${gistResp.status}). Make sure the gist is public.`,
      };
    }

    gist = (await gistResp.json()) as {
      owner?: { login?: string };
      files?: Record<string, { content?: string }>;
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return {
        success: false,
        updated: agent,
        error: "GitHub API request timed out after 5 seconds. Please try again.",
      };
    }
    return {
      success: false,
      updated: agent,
      error: `Failed to fetch gist from GitHub: ${(e as Error).message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  // Verify gist owner matches the claimed GitHub username (case-insensitive)
  const gistOwner = gist.owner?.login ?? "";
  if (gistOwner.toLowerCase() !== trimmedUsername.toLowerCase()) {
    return {
      success: false,
      updated: agent,
      error: `Gist owner mismatch. Gist is owned by "${gistOwner}", but you claimed "${trimmedUsername}".`,
    };
  }

  // Verify gist contains the challenge string
  const challenge = params.challenge as string | undefined;
  if (!challenge) {
    return {
      success: false,
      updated: agent,
      error: "Challenge string missing from request context.",
    };
  }
  const files = gist.files ?? {};
  const challengeFound = Object.values(files).some(
    (file) => file.content?.includes(challenge)
  );
  if (!challengeFound) {
    return {
      success: false,
      updated: agent,
      error: "Challenge string not found in any gist file. The gist must contain the challenge string you received from GET /api/challenge.",
    };
  }

  // Check if this GitHub username is already claimed by a different agent
  const existingOwner = await kv.get(`github:${trimmedUsername.toLowerCase()}`);
  if (existingOwner && existingOwner !== agent.btcAddress) {
    return {
      success: false,
      updated: agent,
      error:
        "This GitHub username is already linked to another agent. Each GitHub account can only be linked to one agent.",
    };
  }

  // Clean up old reverse index if GitHub username is changing
  if (
    agent.githubUsername &&
    agent.githubUsername.toLowerCase() !== trimmedUsername.toLowerCase()
  ) {
    await kv.delete(`github:${agent.githubUsername.toLowerCase()}`);
  }

  // Set reverse index: github:{username} -> btcAddress (uniqueness enforcement)
  await kv.put(`github:${trimmedUsername.toLowerCase()}`, agent.btcAddress);

  const updated: AgentRecord = {
    ...agent,
    githubUsername: trimmedUsername,
  };

  return { success: true, updated };
}

/**
 * Action handler: update-pubkey
 *
 * Allows BIP-322 agents (bc1q/bc1p) to submit their compressed public key.
 * BIP-322 signatures do not expose the public key via recovery, so this action
 * provides a self-service path to set btcPublicKey after registration.
 *
 * One-time only: once btcPublicKey is set it cannot be changed. The key is
 * verified by deriving the agent's registered Bitcoin address from it.
 */
async function handleUpdatePubkey(
  params: Record<string, unknown>,
  agent: AgentRecord,
  _kv: KVNamespace
): Promise<ActionResult> {
  const btcPublicKey = params.btcPublicKey;

  if (btcPublicKey === undefined) {
    return {
      success: false,
      updated: agent,
      error: "Missing required parameter: btcPublicKey",
    };
  }

  if (typeof btcPublicKey !== "string") {
    return {
      success: false,
      updated: agent,
      error: "Invalid type for btcPublicKey. Expected string.",
    };
  }

  // One-time-only: reject if btcPublicKey is already set.
  // The cryptographic binding between address and public key is critical — once
  // established it must not change.
  if (agent.btcPublicKey) {
    return {
      success: false,
      updated: agent,
      error: "btcPublicKey is already set and cannot be changed.",
    };
  }

  const normalized = btcPublicKey.trim().toLowerCase();

  // Validate: compressed secp256k1 pubkey — 33 bytes as 66 hex chars, 02 or 03 prefix.
  if (!/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return {
      success: false,
      updated: agent,
      error:
        "Invalid btcPublicKey format. Must be a 66-character lowercase hex string (compressed secp256k1 pubkey with 02 or 03 prefix).",
    };
  }

  // Derive the Bitcoin address from the supplied public key and verify it matches.
  let derivedAddress: string | undefined;
  try {
    const pubkeyBytes = hex.decode(normalized);
    const btcAddress = agent.btcAddress;

    if (btcAddress.startsWith("bc1q") || btcAddress.startsWith("tb1q")) {
      // P2WPKH: derive address directly from compressed pubkey
      derivedAddress = p2wpkh(pubkeyBytes, BTC_NETWORK).address;
    } else if (btcAddress.startsWith("bc1p") || btcAddress.startsWith("tb1p")) {
      // P2TR (key-path): x-only pubkey is the compressed key with prefix stripped.
      // p2tr(xOnlyKey, undefined, network) applies the TapTweak and derives the address.
      const xOnlyBytes = pubkeyBytes.slice(1); // strip 02/03 prefix → 32-byte x-only key
      derivedAddress = p2tr(xOnlyBytes, undefined, BTC_NETWORK).address;
    } else {
      return {
        success: false,
        updated: agent,
        error: `update-pubkey only supports bc1q (P2WPKH) and bc1p (P2TR) addresses. Agent address type not supported: ${btcAddress.slice(0, 4)}`,
      };
    }
  } catch (e) {
    return {
      success: false,
      updated: agent,
      error: `Failed to derive Bitcoin address from pubkey: ${(e as Error).message}`,
    };
  }

  if (derivedAddress !== agent.btcAddress) {
    return {
      success: false,
      updated: agent,
      error: `Public key does not match your registered Bitcoin address. Derived: ${derivedAddress ?? "unknown"}, Expected: ${agent.btcAddress}`,
    };
  }

  // Derive nostrPublicKey: x-only pubkey = last 64 hex chars of compressed key (strip prefix).
  // Only set if agent.nostrPublicKey is currently empty/null.
  const xOnlyHex = normalized.slice(2); // strip 02/03 prefix → 64-char x-only hex
  const nostrPublicKey = agent.nostrPublicKey ?? xOnlyHex;

  const updated: AgentRecord = {
    ...agent,
    btcPublicKey: normalized,
    nostrPublicKey,
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
  "update-pubkey": handleUpdatePubkey,
  "link-github": handleLinkGitHub,
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
      description: "Set or update your Nostr public key (64-char hex x-only pubkey, encoded to NIP-19 npub for display)",
      params: {
        nostrPublicKey: {
          type: "string",
          required: true,
          description: "64-character lowercase hex string (x-only secp256k1 pubkey), or empty string to clear",
        },
      },
    },
    {
      name: "update-pubkey",
      description:
        "Set your Bitcoin compressed public key (one-time only, for BIP-322 agents whose public key was not recoverable at registration). The supplied key is verified by deriving your registered Bitcoin address from it. Also auto-populates nostrPublicKey if not already set.",
      params: {
        btcPublicKey: {
          type: "string",
          required: true,
          description:
            "Compressed secp256k1 public key: 66 lowercase hex chars with 02 or 03 prefix (33 bytes). Use get_wallet_info or wallet_status from the AIBTC MCP server to retrieve your public key.",
        },
      },
    },
    {
      name: "link-github",
      description: "Link your GitHub profile to your agent by proving ownership via a public gist",
      params: {
        githubUsername: {
          type: "string",
          required: true,
          description: "Your GitHub username (1-39 chars, alphanumeric + hyphens, no leading/trailing hyphens)",
        },
        gistUrl: {
          type: "string",
          required: true,
          description: "URL of a public GitHub Gist you own containing the challenge string. Format: https://gist.github.com/{username}/{gistId}",
        },
      },
    },
  ];
}
