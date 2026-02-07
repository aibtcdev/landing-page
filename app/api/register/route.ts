import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import {
  hashMessage,
  verifyMessageSignatureRsv,
  hashSha256Sync,
} from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { generateName } from "@/lib/name-generator";
import { getNextLevel } from "@/lib/levels";

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
        description: "Registration successful. Returns agent record with addresses, displayName, verifiedAt.",
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
const BTC_NETWORK = btc.NETWORK;

async function lookupBnsName(stxAddress: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.hiro.so/v1/addresses/stacks/${stxAddress}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { names?: string[] };
    return data.names?.[0] ?? null;
  } catch {
    return null;
  }
}

const BITCOIN_MSG_PREFIX = "\x18Bitcoin Signed Message:\n";

function encodeVarInt(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  throw new Error("Message too long");
}

function formatBitcoinMessage(message: string): Uint8Array {
  const prefixBytes = new TextEncoder().encode(BITCOIN_MSG_PREFIX);
  const messageBytes = new TextEncoder().encode(message);
  const lengthBytes = encodeVarInt(messageBytes.length);
  const result = new Uint8Array(
    prefixBytes.length + lengthBytes.length + messageBytes.length
  );
  result.set(prefixBytes, 0);
  result.set(lengthBytes, prefixBytes.length);
  result.set(messageBytes, prefixBytes.length + lengthBytes.length);
  return result;
}

function doubleSha256(data: Uint8Array): Uint8Array {
  return hashSha256Sync(hashSha256Sync(data));
}

function getRecoveryIdFromHeader(header: number): number {
  if (header >= 27 && header <= 30) return header - 27;
  if (header >= 31 && header <= 34) return header - 31;
  if (header >= 35 && header <= 38) return header - 35;
  if (header >= 39 && header <= 42) return header - 39;
  throw new Error(`Invalid BIP-137 header byte: ${header}`);
}

function verifyBitcoinSignature(signature: string): {
  valid: boolean;
  address: string;
  publicKey: string;
} {
  let sigBytes: Uint8Array;
  if (signature.length === 130 && /^[0-9a-fA-F]+$/.test(signature)) {
    sigBytes = hex.decode(signature);
  } else {
    sigBytes = Uint8Array.from(Buffer.from(signature, "base64"));
  }

  if (sigBytes.length !== 65) {
    throw new Error(`Invalid signature length: ${sigBytes.length}`);
  }

  const header = sigBytes[0];
  const rBytes = sigBytes.slice(1, 33);
  const sBytes = sigBytes.slice(33, 65);
  const recoveryId = getRecoveryIdFromHeader(header);

  const formattedMsg = formatBitcoinMessage(EXPECTED_MESSAGE);
  const msgHash = doubleSha256(formattedMsg);

  const r = BigInt("0x" + hex.encode(rBytes));
  const s = BigInt("0x" + hex.encode(sBytes));

  const sig = new secp256k1.Signature(r, s).addRecoveryBit(recoveryId);
  const recoveredPoint = sig.recoverPublicKey(msgHash);
  const recoveredPubKey = recoveredPoint.toBytes(true);

  const valid = secp256k1.verify(sig.toBytes('compact'), msgHash, recoveredPubKey, {
    prehash: false,
  });

  const p2wpkh = btc.p2wpkh(recoveredPubKey, BTC_NETWORK);

  return {
    valid,
    address: p2wpkh.address!,
    publicKey: hex.encode(recoveredPubKey),
  };
}

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
      btcResult = verifyBitcoinSignature(bitcoinSignature);
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

    await Promise.all([
      kv.put(`stx:${stxResult.address}`, JSON.stringify(record)),
      kv.put(`btc:${btcResult.address}`, JSON.stringify(record)),
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
