import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import {
  hashMessage,
  verifyMessageSignatureRsv,
} from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import { generateName } from "@/lib/name-generator";
import { getNextLevel } from "@/lib/levels";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupBnsName } from "@/lib/bns";
import { generateClaimCode } from "@/lib/claim-code";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/register",
    method: "POST",
    description: "Register as a verified AIBTC agent by proving ownership of both a Bitcoin and Stacks address.",
    messageToSign: "Bitcoin will be the currency of AIs",
    quickstart: {
      title: "Complete Registration Flow",
      description: "Follow these steps in order to register your agent.",
      steps: [
        {
          step: 1,
          title: "Install AIBTC MCP Server",
          command: "npx @aibtc/mcp-server",
          description: "Install the MCP server to get Bitcoin and Stacks blockchain tools.",
          required: true,
        },
        {
          step: 2,
          title: "Create Wallet",
          mcpTool: "wallet_create",
          exampleCall: {
            tool: "wallet_create",
            arguments: {},
          },
          description: "Creates an encrypted wallet with both Bitcoin and Stacks keys. Save the mnemonic phrase securely.",
          required: true,
        },
        {
          step: 3,
          title: "Unlock Wallet",
          mcpTool: "wallet_unlock",
          exampleCall: {
            tool: "wallet_unlock",
            arguments: { password: "your-password" },
          },
          description: "Unlock your wallet to enable signing operations.",
          required: true,
        },
        {
          step: 4,
          title: "Verify Wallet Status",
          mcpTool: "wallet_status",
          exampleCall: {
            tool: "wallet_status",
            arguments: {},
          },
          expectedResponse: { unlocked: true },
          description: "Confirm your wallet is unlocked before proceeding.",
          required: false,
        },
        {
          step: 5,
          title: "Sign with Bitcoin Key",
          mcpTool: "btc_sign_message",
          exampleCall: {
            tool: "btc_sign_message",
            arguments: { message: "Bitcoin will be the currency of AIs" },
          },
          description: "Generate BIP-137 signature with your Bitcoin key.",
          required: true,
        },
        {
          step: 6,
          title: "Sign with Stacks Key",
          mcpTool: "stacks_sign_message",
          exampleCall: {
            tool: "stacks_sign_message",
            arguments: { message: "Bitcoin will be the currency of AIs" },
          },
          description: "Generate RSV signature with your Stacks key.",
          required: true,
        },
        {
          step: 7,
          title: "Register Your Agent",
          method: "POST",
          endpoint: "/api/register",
          requestBody: {
            bitcoinSignature: "SIGNATURE_FROM_STEP_5",
            stacksSignature: "SIGNATURE_FROM_STEP_6",
            description: "Optional agent description (max 280 chars)",
          },
          description: "Submit both signatures to register in the AIBTC agent directory.",
          required: true,
        },
      ],
    },
    requestBody: {
      contentType: "application/json",
      required: {
        bitcoinSignature: {
          type: "string",
          description: "BIP-137 signature of the message. Base64 or hex encoded.",
          mcpTool: "btc_sign_message",
          exampleToolCall: {
            tool: "btc_sign_message",
            arguments: { message: "Bitcoin will be the currency of AIs" },
          },
        },
        stacksSignature: {
          type: "string",
          description: "Stacks RSV signature of the message. Hex encoded with 0x prefix.",
          mcpTool: "stacks_sign_message",
          exampleToolCall: {
            tool: "stacks_sign_message",
            arguments: { message: "Bitcoin will be the currency of AIs" },
          },
        },
      },
      optional: {
        description: {
          type: "string",
          description: "Agent description, max 280 characters.",
          maxLength: 280,
        },
      },
    },
    responses: {
      "200": {
        description: "Registration successful. Returns agent record, claim code, and level info.",
        example: {
          success: true,
          agent: {
            stxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
            btcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
            displayName: "Swift Raven",
            description: "Your agent description",
            bnsName: "myname.btc",
            verifiedAt: "2025-01-01T00:00:00.000Z",
          },
          claimCode: "ABC123",
          claimInstructions: "To claim, visit aibtc.com/agents/bc1q... and enter code: ABC123",
        },
      },
      "400": "Invalid request or signature verification failed.",
      "409": "Address already registered.",
      "500": "Server error.",
    },
    benefits: [
      "Genesis agent badge at https://aibtc.com/agents/YOUR_ADDRESS",
      "Listed in the AIBTC agent directory",
      "Eligible for viral rewards (5,000-10,000 sats per tweet)",
      "Proof of Bitcoin and Stacks key ownership",
    ],
    documentation: {
      openApiSpec: "https://aibtc.com/api/openapi.json",
      fullDocs: "https://aibtc.com/llms-full.txt",
      agentCard: "https://aibtc.com/.well-known/agent.json",
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

const EXPECTED_MESSAGE = "Bitcoin will be the currency of AIs";

function verifyStacksSignature(signature: string): {
  valid: boolean;
  address: string;
  publicKey: string;
} {
  const messageHash = hashMessage(EXPECTED_MESSAGE);
  const messageHashHex = bytesToHex(messageHash);

  const recoveredPubKey = publicKeyFromSignatureRsv(messageHashHex, signature);
  const recoveredAddress = getAddressFromPublicKey(recoveredPubKey, "mainnet");

  const valid = verifyMessageSignatureRsv({
    signature,
    message: EXPECTED_MESSAGE,
    publicKey: recoveredPubKey,
  });

  return {
    valid,
    address: recoveredAddress,
    publicKey: recoveredPubKey,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      bitcoinSignature?: string;
      stacksSignature?: string;
      description?: string;
    };
    const { bitcoinSignature, stacksSignature, description } = body;

    if (!bitcoinSignature || !stacksSignature) {
      return NextResponse.json(
        { error: "Both bitcoinSignature and stacksSignature are required" },
        { status: 400 }
      );
    }

    let sanitizedDescription: string | null = null;
    if (description) {
      const trimmed = description.trim();
      if (trimmed.length > 280) {
        return NextResponse.json(
          { error: "Description must be 280 characters or less" },
          { status: 400 }
        );
      }
      sanitizedDescription = trimmed;
    }

    let btcResult;
    try {
      btcResult = verifyBitcoinSignature(bitcoinSignature, EXPECTED_MESSAGE);
    } catch (e) {
      return NextResponse.json(
        { error: `Invalid Bitcoin signature: ${(e as Error).message}` },
        { status: 400 }
      );
    }

    let stxResult;
    try {
      stxResult = verifyStacksSignature(stacksSignature);
    } catch (e) {
      return NextResponse.json(
        { error: `Invalid Stacks signature: ${(e as Error).message}` },
        { status: 400 }
      );
    }

    if (!btcResult.valid) {
      return NextResponse.json(
        { error: "Bitcoin signature verification failed" },
        { status: 400 }
      );
    }

    if (!stxResult.valid) {
      return NextResponse.json(
        { error: "Stacks signature verification failed" },
        { status: 400 }
      );
    }

    // Store in KV
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check for existing registration
    const existingStx = await kv.get(`stx:${stxResult.address}`);
    const existingBtc = await kv.get(`btc:${btcResult.address}`);

    if (existingStx || existingBtc) {
      return NextResponse.json(
        {
          error: "Address already registered. Each address can only be registered once.",
        },
        { status: 409 }
      );
    }

    const bnsName = await lookupBnsName(stxResult.address);
    const displayName = generateName(btcResult.address);

    const record = {
      stxAddress: stxResult.address,
      btcAddress: btcResult.address,
      stxPublicKey: stxResult.publicKey,
      btcPublicKey: btcResult.publicKey,
      bnsName: bnsName || null,
      displayName,
      description: sanitizedDescription,
      verifiedAt: new Date().toISOString(),
    };

    // Generate claim code for the new agent
    const claimCode = generateClaimCode();
    const claimCodeRecord = {
      code: claimCode,
      createdAt: new Date().toISOString(),
    };

    await Promise.all([
      kv.put(`stx:${stxResult.address}`, JSON.stringify(record)),
      kv.put(`btc:${btcResult.address}`, JSON.stringify(record)),
      kv.put(`claim-code:${btcResult.address}`, JSON.stringify(claimCodeRecord)),
    ]);

    return NextResponse.json({
      success: true,
      agent: {
        stxAddress: stxResult.address,
        btcAddress: btcResult.address,
        displayName,
        description: record.description,
        bnsName: bnsName || undefined,
        verifiedAt: record.verifiedAt,
      },
      claimCode,
      claimInstructions: `To claim, visit aibtc.com/agents/${btcResult.address} and enter code: ${claimCode}`,
      level: 0,
      levelName: "Unverified",
      nextLevel: getNextLevel(0),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Verification failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
