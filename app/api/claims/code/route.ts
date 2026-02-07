import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { generateClaimCode } from "@/lib/claim-code";

interface ClaimCodeRecord {
  code: string;
  createdAt: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const btcAddress = searchParams.get("btcAddress");
  const code = searchParams.get("code");

  // Self-documenting: no params → return usage
  if (!btcAddress) {
    return NextResponse.json(
      {
        endpoint: "/api/claims/code",
        description:
          "Claim code management. Codes are generated at registration and required to unlock the tweet claim flow.",
        methods: {
          GET: {
            description:
              "Validate a claim code. Pass btcAddress and code as query parameters.",
            example: "GET /api/claims/code?btcAddress=bc1q...&code=ABC123",
          },
          POST: {
            description:
              "Regenerate a claim code by proving ownership of the Bitcoin key.",
            requestBody: {
              btcAddress: {
                type: "string",
                required: true,
                description: "Your registered agent's BTC address",
              },
              bitcoinSignature: {
                type: "string",
                required: true,
                description:
                  'BIP-137 signature of: "Regenerate claim code for {btcAddress}"',
              },
            },
          },
        },
        documentation: {
          registerFirst: "https://aibtc.com/api/register",
          fullDocs: "https://aibtc.com/llms-full.txt",
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      }
    );
  }

  // Validate code
  if (!code) {
    return NextResponse.json(
      { error: "Both btcAddress and code query parameters are required" },
      { status: 400 }
    );
  }

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const stored = await kv.get(`claim-code:${btcAddress}`);
    if (!stored) {
      return NextResponse.json({ valid: false, reason: "No claim code found for this address" });
    }

    const record = JSON.parse(stored) as ClaimCodeRecord;
    const valid = record.code === code.toUpperCase();

    return NextResponse.json({ valid });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to validate code: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      btcAddress?: string;
      bitcoinSignature?: string;
    };

    const { btcAddress, bitcoinSignature } = body;

    if (!btcAddress || !bitcoinSignature) {
      return NextResponse.json(
        { error: "btcAddress and bitcoinSignature are required" },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Verify the agent is registered
    const agentData = await kv.get(`btc:${btcAddress}`);
    if (!agentData) {
      return NextResponse.json(
        { error: "Agent not found. Register first at /api/register" },
        { status: 404 }
      );
    }

    const agent = JSON.parse(agentData) as { btcPublicKey: string };

    // Verify the Bitcoin signature against the regeneration message
    const message = `Regenerate claim code for ${btcAddress}`;
    let sigResult;
    try {
      sigResult = verifyBitcoinSignature(bitcoinSignature, message);
    } catch (e) {
      return NextResponse.json(
        { error: `Invalid Bitcoin signature: ${(e as Error).message}` },
        { status: 400 }
      );
    }

    if (!sigResult.valid) {
      return NextResponse.json(
        { error: "Bitcoin signature verification failed" },
        { status: 400 }
      );
    }

    // Verify the signature came from the registered key
    if (sigResult.publicKey !== agent.btcPublicKey) {
      return NextResponse.json(
        { error: "Signature does not match the registered Bitcoin key" },
        { status: 403 }
      );
    }

    // Generate new code
    const newCode = generateClaimCode();
    const claimCodeRecord: ClaimCodeRecord = {
      code: newCode,
      createdAt: new Date().toISOString(),
    };

    await kv.put(`claim-code:${btcAddress}`, JSON.stringify(claimCodeRecord));

    return NextResponse.json({
      claimCode: newCode,
      claimInstructions: `To claim, visit aibtc.com/agents/${btcAddress} and enter code: ${newCode}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to regenerate code: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
