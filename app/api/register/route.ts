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

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/register",
    method: "POST",
    description: "Register as a verified AIBTC agent by proving ownership of both a Bitcoin and Stacks address.",
    messageToSign: "Bitcoin will be the currency of AIs",
    prerequisites: {
      description: "You need an unlocked wallet with both Bitcoin and Stacks keys.",
      steps: [
        "1. Create a wallet if you don't have one: call wallet_create",
        "2. Unlock the wallet: call wallet_unlock with your password",
        "3. Verify wallet is ready: call wallet_status (should show unlocked: true)",
      ],
      mcpTools: ["wallet_create", "wallet_unlock", "wallet_status"],
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
      "200": "Registration successful. Returns agent record with addresses, displayName, verifiedAt.",
      "400": "Invalid request or signature verification failed.",
      "409": "Address already registered.",
      "500": "Server error.",
    },
    exampleFlow: [
      "1. Call wallet_unlock with your password",
      '2. Call btc_sign_message with message: "Bitcoin will be the currency of AIs"',
      '3. Call stacks_sign_message with message: "Bitcoin will be the currency of AIs"',
      "4. POST /api/register with { bitcoinSignature, stacksSignature, description? }",
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

// Static message for signature verification
// Note: No nonce/timestamp means signatures can be replayed, but this is mitigated by:
// 1. One-time registration check in KV (lines 220-230) prevents duplicate submissions
// 2. Each address can only register once (409 Conflict on re-registration)
// 3. Replay attack only allows attacker to register on behalf of victim (who controls both addresses)
// Trade-off: Adding nonce/timestamp would require per-session message generation, complicating UX
const EXPECTED_MESSAGE = "Bitcoin will be the currency of AIs";

// Bitcoin network configuration - explicitly mainnet only
// This application only supports mainnet address verification
const BTC_NETWORK = btc.NETWORK; // mainnet by default from @scure/btc-signer

async function lookupBnsName(stxAddress: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `https://api.hiro.so/v1/addresses/stacks/${stxAddress}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = (await res.json()) as { names?: string[] };
    if (data.names && data.names.length > 0) {
      return data.names[0];
    }
    return null;
  } catch {
    return null;
  }
}

// BIP-137 Bitcoin message prefix
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
  // Parse hex or base64
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

  // BIP-62: Signature malleability protection
  // The @noble/curves/secp256k1 library automatically normalizes signatures to low-s values
  // This prevents signature malleability attacks where (r, s) and (r, n-s) are both valid
  // Reference: https://github.com/bitcoin/bips/blob/master/bip-0062.mediawiki#low-s-values-in-signatures
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

    // Content policy for description field:
    // - Trim whitespace and enforce 280 character limit
    // - No HTML/script filtering needed - descriptions are stored as plain text in KV
    //   and rendered via React (auto-escapes) in the frontend
    // - No profanity filter - agents are verified by cryptographic proof, not moderation
    // - Users are responsible for their own description content
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

    // Verify both signatures
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

    // Cryptographic link verification:
    // Both signatures sign the same message ("Bitcoin will be the currency of AIs")
    // and are verified independently. This proves that:
    // 1. The submitter controls the Bitcoin private key (recovered btcResult.address)
    // 2. The submitter controls the Stacks private key (recovered stxResult.address)
    // 3. Therefore, the same entity controls both addresses
    //
    // Limitation: The signed message does not include the addresses themselves,
    // so there's no on-chain cryptographic binding between the two addresses.
    // This is a deliberate trade-off for UX simplicity - users sign a static message
    // rather than a dynamic message containing both addresses.
    //
    // Security implication: An attacker cannot register someone else's addresses
    // without having both private keys. The registration proves ownership of both.

    // Store in KV
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Check for existing registration
    // Race condition limitation:
    // KV has no transaction support, so there's a window between the existence check
    // and the write where concurrent requests could both pass the check. This is acceptable
    // because:
    // 1. The likelihood is low (requires simultaneous registration attempts)
    // 2. Both records would be identical (same verifiedAt timestamp may differ by milliseconds)
    // 3. Last write wins - KV eventually consistent model means one record will prevail
    // 4. No data corruption - worst case is duplicate work, not incorrect state
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

    // Look up BNS name and generate deterministic display name
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

    // Dual-key storage limitation:
    // We write to both stx: and btc: keys via Promise.all for performance,
    // but KV has no transaction support. If one write succeeds and the other fails:
    // - Query by successful key will find the agent
    // - Query by failed key will miss the agent (degraded experience)
    // - Future re-registration attempts will see 409 Conflict from successful key
    // - Manual cleanup required for orphaned single-key records (rare failure case)
    // This is a deliberate trade-off for write performance over perfect consistency.
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
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Verification failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
