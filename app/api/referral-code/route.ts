import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
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
import { lookupAgent } from "@/lib/agent-lookup";
import { computeLevel } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import {
  MAX_REFERRALS,
  MIN_REFERRER_LEVEL,
  getReferralCode,
  getReferralCount,
  generateAndStoreReferralCode,
  deleteReferralLookup,
  getVouchIndex,
} from "@/lib/vouch";
import type { ClaimStatus } from "@/lib/types";

function verifyStacksSignature(signature: string, message: string): {
  valid: boolean;
  address: string;
} {
  const messageHash = hashMessage(message);
  const messageHashHex = bytesToHex(messageHash);
  const recoveredPubKey = publicKeyFromSignatureRsv(messageHashHex, signature);
  const recoveredAddress = getAddressFromPublicKey(recoveredPubKey, "mainnet");
  const valid = verifyMessageSignatureRsv({ signature, message, publicKey: recoveredPubKey });
  return { valid, address: recoveredAddress };
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/referral-code",
    methods: ["GET", "POST"],
    description:
      "Retrieve or regenerate your private referral code. " +
      "Each agent gets a 6-character referral code at registration. " +
      "Share it with new agents who register with ?ref=CODE. " +
      "Your code becomes active once you reach Genesis level (Level 2). " +
      "Each code can refer up to " + MAX_REFERRALS + " agents.",
    post: {
      requestBody: {
        btcAddress: {
          type: "string",
          required: "Required if using bitcoinSignature",
          description: "Your Bitcoin address (bc1...)",
        },
        bitcoinSignature: {
          type: "string",
          required: "One of bitcoinSignature or stxSignature is required",
          description:
            'BIP-137/BIP-322 signature of "Referral code for {btcAddress}"',
        },
        stxAddress: {
          type: "string",
          required: "Required if using stxSignature",
          description: "Your Stacks address (SP...)",
        },
        stxSignature: {
          type: "string",
          required: "One of bitcoinSignature or stxSignature is required",
          description:
            'Stacks signature of "Referral code for {stxAddress}". ' +
            "Use this if your MCP wallet key doesn't match your registered BTC address.",
        },
        regenerate: {
          type: "boolean",
          required: false,
          description:
            "Set to true to generate a new code (invalidates the old one). " +
            "Anyone using your old code will get an invalid_code error.",
        },
      },
      messageToSign: "Referral code for {address}",
      responses: {
        "200": {
          code: "ABC123",
          eligible: true,
          remainingReferrals: 2,
          maxReferrals: MAX_REFERRALS,
          referrals: [
            {
              btcAddress: "bc1q...",
              displayName: "Swift Raven",
              registeredAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        "400": "Invalid signature or missing fields",
        "403": "Signature does not match registered address",
        "404": "Agent not found",
      },
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      btcAddress?: string;
      bitcoinSignature?: string;
      stxAddress?: string;
      stxSignature?: string;
      regenerate?: boolean;
    };

    const { btcAddress, bitcoinSignature, stxAddress, stxSignature, regenerate } = body;

    const hasBtcAuth = btcAddress && bitcoinSignature;
    const hasStxAuth = stxAddress && stxSignature;

    if (!hasBtcAuth && !hasStxAuth) {
      return NextResponse.json(
        {
          error: "Provide either (btcAddress + bitcoinSignature) or (stxAddress + stxSignature)",
        },
        { status: 400 }
      );
    }

    // Verify signature — BTC or STX
    let lookupAddress: string;
    if (hasBtcAuth) {
      const trimmedBtc = btcAddress!.trim();
      const expectedMessage = `Referral code for ${trimmedBtc}`;
      let sigResult;
      try {
        sigResult = verifyBitcoinSignature(bitcoinSignature!, expectedMessage, trimmedBtc);
      } catch (e) {
        return NextResponse.json(
          { error: `Invalid signature: ${(e as Error).message}` },
          { status: 400 }
        );
      }
      if (!sigResult.valid) {
        return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
      }
      if (sigResult.address !== trimmedBtc) {
        return NextResponse.json(
          { error: "Signature does not match the provided btcAddress", recoveredAddress: sigResult.address },
          { status: 403 }
        );
      }
      lookupAddress = trimmedBtc;
    } else {
      const trimmedStx = stxAddress!.trim();
      const expectedMessage = `Referral code for ${trimmedStx}`;
      let sigResult;
      try {
        sigResult = verifyStacksSignature(stxSignature!, expectedMessage);
      } catch (e) {
        return NextResponse.json(
          { error: `Invalid signature: ${(e as Error).message}` },
          { status: 400 }
        );
      }
      if (!sigResult.valid) {
        return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
      }
      if (sigResult.address !== trimmedStx) {
        return NextResponse.json(
          { error: "Signature does not match the provided stxAddress", recoveredAddress: sigResult.address },
          { status: 403 }
        );
      }
      lookupAddress = trimmedStx;
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Look up agent by whichever address was provided
    const agent = await lookupAgent(kv, lookupAddress);
    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found. Register first via POST /api/register." },
        { status: 404 }
      );
    }

    // Check eligibility (Level 2+)
    const claimData = await kv.get(`claim:${agent.btcAddress}`);
    let claimStatus: ClaimStatus | null = null;
    if (claimData) {
      try {
        claimStatus = JSON.parse(claimData) as ClaimStatus;
      } catch { /* ignore */ }
    }
    const level = computeLevel(agent, claimStatus);
    const eligible = level >= MIN_REFERRER_LEVEL;

    // Get or generate referral code
    let codeRecord = await getReferralCode(kv, agent.btcAddress);

    if (regenerate || !codeRecord) {
      const oldCode = codeRecord?.code;
      // Generate new code first, then clean up old reverse lookup
      const newCode = await generateAndStoreReferralCode(kv, agent.btcAddress);
      if (oldCode) {
        await deleteReferralLookup(kv, oldCode);
      }
      codeRecord = { code: newCode, createdAt: new Date().toISOString() };
    }

    // Get referral stats
    const vouchIndex = await getVouchIndex(kv, agent.btcAddress);
    const referralCount = vouchIndex?.refereeAddresses.length ?? 0;

    // Build referral list
    const referrals = await Promise.all(
      (vouchIndex?.refereeAddresses ?? []).map(async (refereeBtc) => {
        const referee = await lookupAgent(kv, refereeBtc);
        return {
          btcAddress: refereeBtc,
          displayName: referee?.displayName || generateName(refereeBtc),
          registeredAt: referee?.verifiedAt || null,
        };
      })
    );

    return NextResponse.json({
      code: codeRecord.code,
      eligible,
      remainingReferrals: Math.max(0, MAX_REFERRALS - referralCount),
      maxReferrals: MAX_REFERRALS,
      referrals,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to process referral code request: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
