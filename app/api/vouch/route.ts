import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { generateName } from "@/lib/name-generator";
import { computeLevel } from "@/lib/levels";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import {
  getVouchIndex,
  lookupReferralCode,
  storeVouch,
  MAX_REFERRALS,
  MIN_REFERRER_LEVEL,
  type VouchRecord,
} from "@/lib/vouch";
import type { ClaimStatus } from "@/lib/types";

/**
 * GET /api/vouch
 *
 * Self-documenting endpoint for the retroactive referral claim.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/vouch",
    methods: ["GET", "POST"],
    description:
      "Retroactively claim who referred you. Only works if you have no existing referrer.",
    post: {
      requestBody: {
        btcAddress: {
          type: "string",
          required: true,
          description: "Your Bitcoin address (bc1...)",
        },
        referralCode: {
          type: "string",
          required: true,
          description: "The 6-character referral code from the agent who referred you.",
        },
        bitcoinSignature: {
          type: "string",
          required: true,
          description:
            'BIP-137/BIP-322 signature of "Claim referral {CODE}" ' +
            '(e.g., "Claim referral ABC123").',
        },
      },
      messageToSign: "Claim referral {CODE}",
      example: {
        btcAddress: "bc1q...",
        referralCode: "ABC123",
        bitcoinSignature: "AkgwRQIh...",
      },
      responses: {
        "200": {
          success: true,
          referredBy: {
            btcAddress: "bc1q...",
            displayName: "Swift Raven",
          },
        },
        "400": "Invalid code, bad signature, referrer not eligible, code exhausted, or self-referral",
        "404": "Your agent not found (recovered address not registered)",
        "409": "Already has a referrer (immutable once set)",
      },
    },
    relatedEndpoints: {
      getYourCode: "POST /api/referral-code",
      vouchStats: "GET /api/vouch/{address}",
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

/**
 * POST /api/vouch
 *
 * Retroactively claim a referral for an existing agent.
 * Only works if the agent has no existing referredBy.
 *
 * Body: { btcAddress, referralCode, bitcoinSignature }
 * Message to sign: "Claim referral {CODE}" (e.g., "Claim referral ABC123")
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      btcAddress?: string;
      referralCode?: string;
      bitcoinSignature?: string;
    };

    const { btcAddress, referralCode, bitcoinSignature } = body;

    if (!btcAddress || !referralCode || !bitcoinSignature) {
      return NextResponse.json(
        { error: "btcAddress, referralCode, and bitcoinSignature are required" },
        { status: 400 }
      );
    }

    const trimmedAddress = btcAddress.trim();

    // Validate code format
    const code = referralCode.trim().toUpperCase();
    if (code.length !== 6) {
      return NextResponse.json(
        { error: "Invalid referral code format. Must be 6 characters." },
        { status: 400 }
      );
    }

    // Verify signature
    const expectedMessage = `Claim referral ${code}`;
    let sigResult;
    try {
      sigResult = verifyBitcoinSignature(bitcoinSignature, expectedMessage, trimmedAddress);
    } catch (e) {
      return NextResponse.json(
        { error: `Invalid signature: ${(e as Error).message}` },
        { status: 400 }
      );
    }

    if (!sigResult.valid) {
      return NextResponse.json(
        { error: "Signature verification failed." },
        { status: 400 }
      );
    }

    // Verify the signature is from the claimed address
    if (sigResult.address !== trimmedAddress) {
      return NextResponse.json(
        {
          error: "Signature does not match the provided btcAddress.",
          recoveredAddress: sigResult.address,
        },
        { status: 403 }
      );
    }

    const agentBtcAddress = trimmedAddress;

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Look up the agent by recovered address
    const agent = await lookupAgent(kv, agentBtcAddress);
    if (!agent) {
      return NextResponse.json(
        {
          error: "Agent not found for the recovered address. Register first via POST /api/register.",
          recoveredAddress: agentBtcAddress,
        },
        { status: 404 }
      );
    }

    // Check if agent already has a referrer
    if (agent.referredBy) {
      return NextResponse.json(
        {
          error: "This agent already has a referrer. Referrals are immutable once set.",
          referredBy: agent.referredBy,
        },
        { status: 409 }
      );
    }

    // Resolve referral code → referrer
    const referrerBtcAddress = await lookupReferralCode(kv, code);
    if (!referrerBtcAddress) {
      return NextResponse.json(
        { error: "Invalid referral code." },
        { status: 400 }
      );
    }

    // Prevent self-referral
    if (referrerBtcAddress === agent.btcAddress) {
      return NextResponse.json(
        { error: "Cannot refer yourself." },
        { status: 400 }
      );
    }

    // Look up referrer
    const referrer = await lookupAgent(kv, referrerBtcAddress);
    if (!referrer) {
      return NextResponse.json(
        { error: "Referrer agent not found." },
        { status: 400 }
      );
    }

    // Prevent self-referral via STX address
    if (referrer.stxAddress === agent.stxAddress) {
      return NextResponse.json(
        { error: "Cannot refer yourself." },
        { status: 400 }
      );
    }

    // Check referrer level (must be Genesis / Level 2+)
    const referrerClaim = await kv.get(`claim:${referrer.btcAddress}`);
    let referrerClaimStatus: ClaimStatus | null = null;
    if (referrerClaim) {
      try {
        referrerClaimStatus = JSON.parse(referrerClaim) as ClaimStatus;
      } catch { /* ignore */ }
    }
    const referrerLevel = computeLevel(referrer, referrerClaimStatus);
    if (referrerLevel < MIN_REFERRER_LEVEL) {
      return NextResponse.json(
        { error: "Referrer has not reached Genesis level (Level 2) yet." },
        { status: 400 }
      );
    }

    // Check referral count
    const vouchIndex = await getVouchIndex(kv, referrer.btcAddress);
    const referralCount = vouchIndex?.refereeAddresses.length ?? 0;
    if (referralCount >= MAX_REFERRALS) {
      return NextResponse.json(
        { error: "This referral code has reached its maximum number of referrals." },
        { status: 400 }
      );
    }

    // Update agent record with referredBy
    const updatedAgent = { ...agent, referredBy: referrer.btcAddress };
    await Promise.all([
      kv.put(`btc:${agent.btcAddress}`, JSON.stringify(updatedAgent)),
      kv.put(`stx:${agent.stxAddress}`, JSON.stringify(updatedAgent)),
    ]);

    // Store the vouch record
    const vouchRecord: VouchRecord = {
      referrer: referrer.btcAddress,
      referee: agent.btcAddress,
      registeredAt: agent.verifiedAt,
    };
    await storeVouch(kv, vouchRecord);

    return NextResponse.json({
      success: true,
      agent: {
        btcAddress: agent.btcAddress,
        displayName: agent.displayName || generateName(agent.btcAddress),
      },
      referredBy: {
        btcAddress: referrer.btcAddress,
        displayName: referrer.displayName || generateName(referrer.btcAddress),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to claim referral: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
