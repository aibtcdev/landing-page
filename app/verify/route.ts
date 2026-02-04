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

const EXPECTED_MESSAGE = "Bitcoin will be the currency of AIs";

async function lookupBnsName(stxAddress: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.hiro.so/v1/addresses/stacks/${stxAddress}`
    );
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

  const sig = new secp256k1.Signature(r, s, recoveryId);
  const recoveredPoint = sig.recoverPublicKey(msgHash);
  const recoveredPubKey = recoveredPoint.toBytes(true);

  const valid = secp256k1.verify(sig.toBytes(), msgHash, recoveredPubKey, {
    prehash: false,
  });

  const p2wpkh = btc.p2wpkh(recoveredPubKey, btc.NETWORK);

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

    // Look up BNS name and generate deterministic display name
    const bnsName = await lookupBnsName(stxResult.address);
    const displayName = generateName(stxResult.address);

    // Store in KV
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const record = {
      stxAddress: stxResult.address,
      btcAddress: btcResult.address,
      stxPublicKey: stxResult.publicKey,
      btcPublicKey: btcResult.publicKey,
      bnsName: bnsName || null,
      displayName,
      description: description || null,
      verifiedAt: new Date().toISOString(),
    };

    // Key by STX address, also index by BTC address
    await kv.put(`stx:${stxResult.address}`, JSON.stringify(record));
    await kv.put(`btc:${btcResult.address}`, JSON.stringify(record));

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
