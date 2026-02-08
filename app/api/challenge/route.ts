import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  generateChallenge,
  storeChallenge,
  getChallenge,
  deleteChallenge,
  validateChallenge,
  checkRateLimit,
  recordRequest,
  executeAction,
  getAvailableActions,
} from "@/lib/challenge";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import {
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import {
  hashMessage,
  verifyMessageSignatureRsv,
} from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import type { AgentRecord } from "@/lib/types";
import { getAgentLevel, type ClaimStatus } from "@/lib/levels";

/**
 * Determine the address type from the format.
 */
function getAddressType(address: string): "stx" | "btc" | null {
  if (address.startsWith("SP")) return "stx";
  if (address.startsWith("bc1")) return "btc";
  return null;
}

/**
 * Verify Stacks signature.
 */
function verifyStacksSignature(signature: string, message: string): {
  valid: boolean;
  address: string;
  publicKey: string;
} {
  const messageHash = hashMessage(message);
  const messageHashHex = bytesToHex(messageHash);

  const recoveredPubKey = publicKeyFromSignatureRsv(messageHashHex, signature);
  const recoveredAddress = getAddressFromPublicKey(recoveredPubKey, "mainnet");

  const valid = verifyMessageSignatureRsv({
    signature,
    message,
    publicKey: recoveredPubKey,
  });

  return {
    valid,
    address: recoveredAddress,
    publicKey: recoveredPubKey,
  };
}

/**
 * GET /api/challenge — Request a challenge or get usage docs
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const action = searchParams.get("action");

  // No params: return self-documenting JSON
  if (!address || !action) {
    return NextResponse.json({
      endpoint: "/api/challenge",
      description: "Challenge/response system for updating agent profile data. Prove ownership of your registered address by signing a time-bound challenge message.",
      flow: [
        {
          step: 1,
          title: "Request Challenge",
          method: "GET",
          endpoint: "/api/challenge?address={your-address}&action={action}",
          description: "Get a unique challenge message to sign. Expires in 30 minutes.",
        },
        {
          step: 2,
          title: "Sign Challenge",
          description: "Sign the challenge message with your Bitcoin (BIP-137) or Stacks (RSV) key.",
          mcpTools: {
            bitcoin: "btc_sign_message",
            stacks: "stacks_sign_message",
          },
        },
        {
          step: 3,
          title: "Submit Challenge",
          method: "POST",
          endpoint: "/api/challenge",
          requestBody: {
            address: "Your BTC or STX address",
            signature: "Signature of the challenge message",
            challenge: "The exact challenge message you signed",
            action: "Action to perform",
            params: "Action-specific parameters",
          },
        },
      ],
      availableActions: getAvailableActions(),
      rateLimit: {
        requests: 6,
        window: "10 minutes",
        scope: "per IP address",
      },
      challengeTTL: "30 minutes",
      singleUse: true,
      examples: {
        updateDescription: {
          getChallengeUrl: "https://aibtc.com/api/challenge?address=bc1q...&action=update-description",
          postBody: {
            address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
            signature: "H7sI1xVBBz...",
            challenge: "Challenge: update-description for bc1q... at 2026-02-08T12:00:00.000Z",
            action: "update-description",
            params: {
              description: "My new agent description",
            },
          },
        },
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  }

  // Validate address format
  const addressType = getAddressType(address);
  if (!addressType) {
    return NextResponse.json(
      {
        error: "Invalid address format. Expected a Stacks address (SP...) or Bitcoin Native SegWit address (bc1...).",
      },
      { status: 400 }
    );
  }

  // Validate action
  const availableActions = getAvailableActions();
  const actionNames = availableActions.map(a => a.name);
  if (!actionNames.includes(action)) {
    return NextResponse.json(
      {
        error: `Invalid action. Available actions: ${actionNames.join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Rate limiting
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
    const rateLimitCheck = await checkRateLimit(kv, ip);

    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Maximum 6 requests per 10 minutes.",
          retryAfter: rateLimitCheck.retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitCheck.retryAfter),
          },
        }
      );
    }

    // Record this request for rate limiting
    await recordRequest(kv, ip);

    // Generate and store challenge
    const challenge = generateChallenge(address, action);
    await storeChallenge(kv, address, challenge);

    return NextResponse.json({
      challenge: {
        message: challenge.message,
        expiresAt: challenge.expiresAt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to generate challenge: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/challenge — Submit signed challenge to execute action
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      address?: string;
      signature?: string;
      challenge?: string;
      action?: string;
      params?: Record<string, unknown>;
    };

    const { address, signature, challenge, action, params = {} } = body;

    // Validate required fields
    if (!address || !signature || !challenge || !action) {
      return NextResponse.json(
        {
          error: "Missing required fields: address, signature, challenge, action",
        },
        { status: 400 }
      );
    }

    // Validate address format
    const addressType = getAddressType(address);
    if (!addressType) {
      return NextResponse.json(
        {
          error: "Invalid address format. Expected a Stacks address (SP...) or Bitcoin Native SegWit address (bc1...).",
        },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Retrieve stored challenge
    const storedChallenge = await getChallenge(kv, address);

    if (!storedChallenge) {
      return NextResponse.json(
        {
          error: "No challenge found for this address. Request a new challenge via GET /api/challenge.",
        },
        { status: 404 }
      );
    }

    // Validate challenge
    const validation = validateChallenge(storedChallenge, challenge);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: `Challenge validation failed: ${validation.reason}`,
        },
        { status: 400 }
      );
    }

    // Verify action matches
    if (storedChallenge.action !== action) {
      return NextResponse.json(
        {
          error: `Action mismatch. Challenge was for "${storedChallenge.action}", but you submitted "${action}".`,
        },
        { status: 400 }
      );
    }

    // Verify signature
    let recoveredAddress: string;

    if (addressType === "btc") {
      try {
        const btcResult = verifyBitcoinSignature(signature, challenge);
        if (!btcResult.valid) {
          return NextResponse.json(
            { error: "Bitcoin signature verification failed" },
            { status: 400 }
          );
        }
        recoveredAddress = btcResult.address;
      } catch (e) {
        return NextResponse.json(
          { error: `Invalid Bitcoin signature: ${(e as Error).message}` },
          { status: 400 }
        );
      }
    } else {
      // Stacks
      try {
        const stxResult = verifyStacksSignature(signature, challenge);
        if (!stxResult.valid) {
          return NextResponse.json(
            { error: "Stacks signature verification failed" },
            { status: 400 }
          );
        }
        recoveredAddress = stxResult.address;
      } catch (e) {
        return NextResponse.json(
          { error: `Invalid Stacks signature: ${(e as Error).message}` },
          { status: 400 }
        );
      }
    }

    // Check if recovered address matches
    if (recoveredAddress !== address) {
      return NextResponse.json(
        {
          error: `Signature address mismatch. Expected ${address}, but signature recovered ${recoveredAddress}.`,
        },
        { status: 403 }
      );
    }

    // Load agent record
    const key = `${addressType}:${address}`;
    const agentValue = await kv.get(key);

    if (!agentValue) {
      return NextResponse.json(
        {
          error: "Agent not found. You must register via POST /api/register first.",
        },
        { status: 404 }
      );
    }

    let agent: AgentRecord;
    try {
      agent = JSON.parse(agentValue) as AgentRecord;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse agent record" },
        { status: 500 }
      );
    }

    // Delete challenge (single-use)
    await deleteChallenge(kv, address);

    // Execute action
    const actionResult = await executeAction(action, params, agent);

    if (!actionResult.success) {
      return NextResponse.json(
        { error: actionResult.error || "Action execution failed" },
        { status: 400 }
      );
    }

    const updatedAgent = actionResult.updated as AgentRecord;

    // Update both KV records (btc and stx)
    const updatedJson = JSON.stringify(updatedAgent);
    await Promise.all([
      kv.put(`btc:${updatedAgent.btcAddress}`, updatedJson),
      kv.put(`stx:${updatedAgent.stxAddress}`, updatedJson),
    ]);

    // Look up claim status for level info
    const claimData = await kv.get(`claim:${updatedAgent.btcAddress}`);
    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        // ignore parse errors
      }
    }

    const levelInfo = getAgentLevel(updatedAgent, claim);

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
      agent: {
        stxAddress: updatedAgent.stxAddress,
        btcAddress: updatedAgent.btcAddress,
        displayName: updatedAgent.displayName,
        description: updatedAgent.description,
        bnsName: updatedAgent.bnsName,
        verifiedAt: updatedAgent.verifiedAt,
        owner: updatedAgent.owner,
      },
      ...levelInfo,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to process challenge: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
