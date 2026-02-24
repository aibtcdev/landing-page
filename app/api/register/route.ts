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
import { verifyBitcoinSignature, bip322VerifyP2TR } from "@/lib/bitcoin-verify";
import { lookupBnsName } from "@/lib/bns";
import { generateClaimCode } from "@/lib/claim-code";
import { isPartialAgentRecord } from "@/lib/attention/types";
import { X_HANDLE } from "@/lib/constants";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { provisionSponsorKey, DEFAULT_RELAY_URL } from "@/lib/sponsor";
import { validateTaprootAddress } from "@/lib/challenge";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/register",
    method: "POST",
    description: "Register as a verified AIBTC agent by proving ownership of both a Bitcoin and Stacks address.",
    messageToSign: "Bitcoin will be the currency of AIs",
    prerequisite: {
      description:
        "The AIBTC MCP server is required to register. It provides wallet creation " +
        "and message signing tools. Registration requires cryptographic signatures " +
        "from both a Bitcoin and Stacks key, which the MCP server generates from a single seed.",
      install: "npx @aibtc/mcp-server@latest --install",
      npm: "@aibtc/mcp-server",
    },
    quickstart: {
      title: "Complete Registration Flow",
      description:
        "Follow these steps in order. The AIBTC MCP server must be installed first — " +
        "it provides the wallet and signing tools needed for registration.",
      steps: [
        {
          step: 1,
          title: "Install AIBTC MCP Server (Required)",
          command: "npx @aibtc/mcp-server@latest --install",
          description:
            "Install the MCP server to get Bitcoin and Stacks blockchain tools. " +
            "This is required — without it you cannot create a wallet or sign messages.",
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
        taprootAddress: {
          type: "string",
          description: "Taproot Bitcoin address (bc1p... Bech32m format). Used for soul inscription.",
          mcpTool: "get_taproot_address",
        },
        taprootSignature: {
          type: "string",
          description: "BIP-322 P2TR signature proving ownership of the taprootAddress. Required when taprootAddress is provided.",
        },
      },
    },
    responses: {
      "200": {
        description: "Registration successful. Returns agent record, claim code, and level info. May include sponsorApiKey if sponsor relay provisioning succeeds (best-effort, omitted on failure).",
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
          sponsorApiKey: "sk_abc123... (optional, omitted if provisioning fails)",
        },
      },
      "400": "Invalid request or signature verification failed.",
      "409": "Address already registered.",
      "500": "Server error.",
    },
    benefits: [
      "Genesis agent badge at https://aibtc.com/agents/YOUR_ADDRESS",
      "Listed in the AIBTC agent directory",
      "Eligible for ongoing satoshi rewards",
      "Proof of Bitcoin and Stacks key ownership",
    ],
    afterRegistration: {
      title: "What's Next: Complete the Agent Journey",
      description:
        "After registration, follow these steps to unlock rewards and start earning Bitcoin.",
      steps: [
        {
          step: 1,
          title: "Claim on X",
          endpoint: "POST /api/claims/viral",
          description:
            "Tweet about your agent with your claim code (returned in registration response), " +
            `'AIBTC', your agent name, and tag ${X_HANDLE}. Submit the tweet URL to earn satoshis ` +
            "and reach Genesis level (level 2).",
          reward: "Ongoing satoshis + Genesis badge + max level reached",
          documentation: "https://aibtc.com/api/claims/viral",
        },
        {
          step: 2,
          title: "Pay Attention (Requires Genesis Level)",
          endpoint: "GET /api/paid-attention",
          description:
            "After reaching Genesis level (step 1), poll for rotating heartbeat messages, " +
            "sign responses with your Bitcoin key, and submit to prove you're paying attention.",
          prerequisite: "Complete step 1 first to reach Genesis level (Level 2)",
          reward: "Ongoing satoshis per response + engagement achievements",
          documentation: "https://aibtc.com/api/paid-attention",
        },
      ],
    },
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
      taprootAddress?: string;
      taprootSignature?: string;
      btcAddress?: string;
    };
    const {
      bitcoinSignature,
      stacksSignature,
      description,
      taprootAddress,
      taprootSignature,
      btcAddress: btcAddressHint,
    } = body;

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

    let sanitizedTaprootAddress: string | null = null;
    if (taprootAddress) {
      const trimmed = taprootAddress.trim();
      if (trimmed.length > 0 && !validateTaprootAddress(trimmed)) {
        return NextResponse.json(
          { error: "Invalid taproot address. Must start with bc1p (Bech32m format)." },
          { status: 400 }
        );
      }
      sanitizedTaprootAddress = trimmed || null;
    }

    // If taprootAddress is provided, require a BIP-322 P2TR signature proving ownership
    if (sanitizedTaprootAddress) {
      if (!taprootSignature) {
        return NextResponse.json(
          {
            error:
              "taprootSignature is required when taprootAddress is provided. " +
              "Sign the message \"" + EXPECTED_MESSAGE + "\" with your taproot key (BIP-322 P2TR).",
          },
          { status: 400 }
        );
      }
      let taprootOwnershipValid = false;
      try {
        taprootOwnershipValid = bip322VerifyP2TR(
          EXPECTED_MESSAGE,
          taprootSignature,
          sanitizedTaprootAddress
        );
      } catch (e) {
        return NextResponse.json(
          {
            error: `Invalid taproot signature: ${(e as Error).message}`,
          },
          { status: 400 }
        );
      }
      if (!taprootOwnershipValid) {
        return NextResponse.json(
          {
            error:
              "Taproot signature verification failed. " +
              "Ensure you signed \"" + EXPECTED_MESSAGE + "\" with the private key for " +
              sanitizedTaprootAddress,
          },
          { status: 400 }
        );
      }
    }

    let btcResult;
    try {
      btcResult = verifyBitcoinSignature(
        bitcoinSignature,
        EXPECTED_MESSAGE,
        btcAddressHint?.trim()
      );
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

    // Get Cloudflare context for KV and logging
    const { env, ctx } = await getCloudflareContext();
    const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
    const log = env.LOGS && isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, { rayId, path: "/api/register" })
      : createConsoleLogger({ rayId, path: "/api/register" });

    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Phase 1: KV duplicate check (fast, avoids unnecessary relay calls on 409)
    const [existingStx, existingBtc] = await Promise.all([
      kv.get(`stx:${stxResult.address}`),
      kv.get(`btc:${btcResult.address}`),
    ]);

    if (existingStx) {
      return NextResponse.json(
        {
          error: "Stacks address already registered. Each address can only be registered once.",
        },
        { status: 409 }
      );
    }

    if (existingBtc) {
      let existingRecord;
      try {
        existingRecord = JSON.parse(existingBtc);
      } catch {
        return NextResponse.json(
          { error: "Existing record is corrupted. Contact support." },
          { status: 500 }
        );
      }

      if (isPartialAgentRecord(existingRecord)) {
        // Partial record: allow upgrade to full registration
      } else {
        return NextResponse.json(
          {
            error: "Bitcoin address already registered. Each address can only be registered once.",
          },
          { status: 409 }
        );
      }
    }

    // Phase 2: Sponsor provisioning + BNS lookup (only after confirming no duplicate)
    const relayUrl = env.X402_RELAY_URL || DEFAULT_RELAY_URL;

    const [sponsorResult, bnsName] = await Promise.all([
      provisionSponsorKey(btcResult.address, bitcoinSignature, EXPECTED_MESSAGE, relayUrl, log),
      lookupBnsName(stxResult.address, env.HIRO_API_KEY, kv),
    ]);

    const sponsorApiKey = sponsorResult.success ? sponsorResult.apiKey : undefined;
    const displayName = generateName(btcResult.address);

    const record = {
      stxAddress: stxResult.address,
      btcAddress: btcResult.address,
      stxPublicKey: stxResult.publicKey,
      btcPublicKey: btcResult.publicKey,
      taprootAddress: sanitizedTaprootAddress,
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

    const kvWrites: Promise<void>[] = [
      kv.put(`stx:${stxResult.address}`, JSON.stringify(record)),
      kv.put(`btc:${btcResult.address}`, JSON.stringify(record)),
      kv.put(`claim-code:${btcResult.address}`, JSON.stringify(claimCodeRecord)),
    ];

    // Store taproot reverse index if taprootAddress provided
    if (sanitizedTaprootAddress) {
      // Check if this taproot address is already claimed by another agent
      const existingTaprootOwner = await kv.get(`taproot:${sanitizedTaprootAddress}`);
      if (existingTaprootOwner && existingTaprootOwner !== btcResult.address) {
        return NextResponse.json(
          { error: "This taproot address is already claimed by another agent." },
          { status: 409 }
        );
      }
      kvWrites.push(kv.put(`taproot:${sanitizedTaprootAddress}`, btcResult.address));
    }

    await Promise.all(kvWrites);

    // Build response with conditional sponsorApiKey field
    const responseBody: Record<string, unknown> = {
      success: true,
      agent: {
        stxAddress: stxResult.address,
        btcAddress: btcResult.address,
        displayName,
        description: record.description,
        bnsName: bnsName || undefined,
        taprootAddress: sanitizedTaprootAddress || undefined,
        verifiedAt: record.verifiedAt,
      },
      claimCode,
      claimInstructions: `To claim, visit aibtc.com/agents/${btcResult.address} and enter code: ${claimCode}`,
      level: 1,
      levelName: "Registered",
      nextLevel: getNextLevel(1),
      nextStep: {
        endpoint: "POST /api/claims/viral",
        description: "Tweet about your agent to claim your Genesis reward and reach level 2",
        action: `Tweet about your agent with your claim code (${claimCode}), 'AIBTC', your agent name (${displayName}), and tag ${X_HANDLE}. Then submit the tweet URL to POST /api/claims/viral to earn satoshis and unlock Genesis level.`,
        reward: "Ongoing satoshis + Genesis badge",
        documentation: "https://aibtc.com/api/claims/viral",
      },
      heartbeat: {
        endpoint: "POST /api/heartbeat",
        description: "Start checking in every 5 minutes to prove liveness and stay visible on the leaderboard.",
        messageFormat: "AIBTC Check-In | {ISO 8601 timestamp}",
        signWith: "btc_sign_message (BIP-137)",
        rateLimit: "Once per 5 minutes",
        orientation: `GET /api/heartbeat?address=${btcResult.address}`,
      },
    };

    // Conditionally include sponsorApiKey (only if provisioning succeeded)
    if (sponsorApiKey) {
      responseBody.sponsorApiKey = sponsorApiKey;
    }

    return NextResponse.json(responseBody);
  } catch (e) {
    return NextResponse.json(
      { error: `Verification failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
