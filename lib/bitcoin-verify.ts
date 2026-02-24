import { hashSha256Sync } from "@stacks/encryption";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import {
  Transaction,
  p2wpkh,
  p2pkh,
  p2sh,
  Script,
  SigHash,
  RawWitness,
  RawTx,
  Address,
  NETWORK as BTC_NETWORK,
} from "@scure/btc-signer";

export { BTC_NETWORK };
export const BITCOIN_MSG_PREFIX = "\x18Bitcoin Signed Message:\n";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function encodeVarInt(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  if (n <= 0xffffffff) {
    const buf = new Uint8Array(5);
    buf[0] = 0xfe;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    buf[3] = (n >> 16) & 0xff;
    buf[4] = (n >> 24) & 0xff;
    return buf;
  }
  throw new Error("Message too long");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function writeUint32LE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = n & 0xff;
  buf[1] = (n >> 8) & 0xff;
  buf[2] = (n >> 16) & 0xff;
  buf[3] = (n >> 24) & 0xff;
  return buf;
}

function writeUint64LE(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = n;
  const mask = BigInt(0xff);
  const shift = BigInt(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & mask);
    v >>= shift;
  }
  return buf;
}

/**
 * Convert a DER-encoded ECDSA signature to compact (64-byte) format.
 *
 * Bitcoin witness stacks store ECDSA signatures in DER format with a hashtype byte appended.
 * @noble/curves secp256k1.verify() requires compact (64-byte r||s) format in v2.
 *
 * DER format: 30 <total_len> 02 <r_len> [00?] <r_bytes> 02 <s_len> [00?] <s_bytes>
 * The leading 0x00 is padding for high-bit integers (to keep the sign positive).
 */
function parseDERSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("parseDERSignature: expected 0x30 header");
  let pos = 2; // skip 0x30 and total length byte
  if (der[pos] !== 0x02) throw new Error("parseDERSignature: expected 0x02 for r");
  pos++;
  const rLen = der[pos++];
  if (pos + rLen > der.length) throw new Error("parseDERSignature: r extends beyond signature");
  // Strip optional leading 0x00 padding byte (added when high bit is set)
  const rBytes = der.slice(rLen === 33 ? pos + 1 : pos, pos + rLen);
  pos += rLen;
  if (der[pos] !== 0x02) throw new Error("parseDERSignature: expected 0x02 for s");
  pos++;
  const sLen = der[pos++];
  if (pos + sLen > der.length) throw new Error("parseDERSignature: s extends beyond signature");
  const sBytes = der.slice(sLen === 33 ? pos + 1 : pos, pos + sLen);

  const compact = new Uint8Array(64);
  compact.set(rBytes, 32 - rBytes.length);  // left-pad r
  compact.set(sBytes, 64 - sBytes.length);  // left-pad s
  return compact;
}

export function formatBitcoinMessage(message: string): Uint8Array {
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

export function doubleSha256(data: Uint8Array): Uint8Array {
  return hashSha256Sync(hashSha256Sync(data));
}

export function getRecoveryIdFromHeader(header: number): number {
  if (header >= 27 && header <= 30) return header - 27;
  if (header >= 31 && header <= 34) return header - 31;
  if (header >= 35 && header <= 38) return header - 35;
  if (header >= 39 && header <= 42) return header - 39;
  throw new Error(`Invalid BIP-137 header byte: ${header}`);
}

/**
 * Detect whether a decoded signature is BIP-137 (65 bytes, header 27-42) or BIP-322.
 */
function isBip137Signature(sigBytes: Uint8Array): boolean {
  return sigBytes.length === 65 && sigBytes[0] >= 27 && sigBytes[0] <= 42;
}

// ---------------------------------------------------------------------------
// BIP-322 helper functions
// ---------------------------------------------------------------------------

/**
 * BIP-322 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || varint(msg.len) || msg)
 * where tag = "BIP0322-signed-message"
 */
function bip322TaggedHash(message: string): Uint8Array {
  const tagBytes = new TextEncoder().encode("BIP0322-signed-message");
  const tagHash = hashSha256Sync(tagBytes);
  const msgBytes = new TextEncoder().encode(message);
  const varint = encodeVarInt(msgBytes.length);
  const msgPart = concatBytes(varint, msgBytes);
  return hashSha256Sync(concatBytes(tagHash, tagHash, msgPart));
}

/**
 * Build the BIP-322 to_spend virtual transaction and return its txid (32 bytes, LE).
 *
 * The to_spend tx is a virtual legacy transaction:
 * - Input: txid=zero32, vout=0xFFFFFFFF, sequence=0, scriptSig = OP_0 push32 <msgHash>
 * - Output: amount=0, script=scriptPubKey of the signing address
 *
 * The txid is computed as doubleSha256 of the legacy (non-segwit) serialization.
 */
function bip322BuildToSpendTxId(
  message: string,
  scriptPubKey: Uint8Array
): Uint8Array {
  const msgHash = bip322TaggedHash(message);
  // scriptSig: OP_0 (0x00) push32 (0x20) <32-byte hash>
  const scriptSig = concatBytes(new Uint8Array([0x00, 0x20]), msgHash);

  const rawTx = RawTx.encode({
    version: 0,
    inputs: [
      {
        txid: new Uint8Array(32),
        index: 0xffffffff,
        finalScriptSig: scriptSig,
        sequence: 0,
      },
    ],
    outputs: [
      {
        amount: BigInt(0),
        script: scriptPubKey,
      },
    ],
    lockTime: 0,
  });

  // txid is double-SHA256 of the serialized tx, returned in little-endian byte order
  return doubleSha256(rawTx).reverse();
}

/**
 * BIP-322 "simple" verification for P2WPKH (bc1q) addresses.
 */
export function bip322VerifyP2WPKH(
  message: string,
  signatureBase64: string,
  address: string
): boolean {
  const sigBytes = Uint8Array.from(Buffer.from(signatureBase64, "base64"));
  const witnessItems = RawWitness.decode(sigBytes);

  if (witnessItems.length !== 2) {
    throw new Error(
      `P2WPKH BIP-322: expected 2 witness items, got ${witnessItems.length}`
    );
  }

  const ecdsaSigWithHashtype = witnessItems[0];
  const pubkeyBytes = witnessItems[1];

  if (pubkeyBytes.length !== 33) {
    throw new Error(
      `P2WPKH BIP-322: expected 33-byte compressed pubkey, got ${pubkeyBytes.length}`
    );
  }

  // Derive scriptPubKey from witness pubkey
  const scriptPubKey = p2wpkh(pubkeyBytes, BTC_NETWORK).script;

  // Build to_spend txid
  const toSpendTxid = bip322BuildToSpendTxId(message, scriptPubKey);

  // Build (unsigned) to_sign transaction for sighash computation.
  // allowUnknownOutputs: true is required for the OP_RETURN output in BIP-322 virtual transactions.
  const toSignTx = new Transaction({ version: 0, lockTime: 0, allowUnknownOutputs: true });
  toSignTx.addInput({
    txid: toSpendTxid,
    index: 0,
    sequence: 0,
    witnessUtxo: { amount: BigInt(0), script: scriptPubKey },
  });
  toSignTx.addOutput({ script: Script.encode(["RETURN"]), amount: BigInt(0) });

  // Compute BIP143 witness-v0 sighash
  // scriptCode for P2WPKH is the P2PKH script: OP_DUP OP_HASH160 <hash160(pubkey)> OP_EQUALVERIFY OP_CHECKSIG
  const scriptCode = p2pkh(pubkeyBytes).script;
  const sighash = toSignTx.preimageWitnessV0(0, scriptCode, SigHash.ALL, BigInt(0));

  // Strip hashtype byte from DER signature.
  // @noble/curves secp256k1.verify() in v2 requires compact (64-byte) format, not DER.
  const derSig = ecdsaSigWithHashtype.slice(0, -1);
  const compactSig = parseDERSignature(derSig);

  // Verify ECDSA signature
  const sigValid = secp256k1.verify(compactSig, sighash, pubkeyBytes, {
    prehash: false,
  });
  if (!sigValid) return false;

  // Confirm derived address matches claimed address
  const derivedAddress = p2wpkh(pubkeyBytes, BTC_NETWORK).address;
  return derivedAddress === address;
}

/**
 * BIP-322 "simple" verification for P2TR (bc1p) addresses.
 *
 * Reconstructs the to_sign transaction, computes the BIP341 tapscript sighash manually,
 * verifies the Schnorr signature, and checks the pubkey matches the address.
 */
export function bip322VerifyP2TR(
  message: string,
  signatureBase64: string,
  address: string
): boolean {
  const sigBytes = Uint8Array.from(Buffer.from(signatureBase64, "base64"));
  const witnessItems = RawWitness.decode(sigBytes);

  if (witnessItems.length !== 1) {
    throw new Error(
      `P2TR BIP-322: expected 1 witness item, got ${witnessItems.length}`
    );
  }

  const schnorrSig = witnessItems[0];
  if (schnorrSig.length !== 64) {
    throw new Error(
      `P2TR BIP-322: expected 64-byte Schnorr sig, got ${schnorrSig.length}`
    );
  }

  // Extract the tweaked output key from the P2TR address.
  // Address().decode() returns decoded.pubkey = the TWEAKED key embedded in the bech32 data.
  // We must NOT call p2tr(decoded.pubkey, ...) — that would apply another TapTweak.
  // Instead, build the scriptPubKey directly: OP_1 (0x51) OP_PUSH32 (0x20) <tweakedKey>
  const decoded = Address(BTC_NETWORK).decode(address);
  if (decoded.type !== "tr") {
    throw new Error(`P2TR BIP-322: address does not decode to P2TR type`);
  }
  const tweakedKey = decoded.pubkey;

  // Build scriptPubKey for this P2TR address directly (no double-tweak)
  const scriptPubKey = new Uint8Array([0x51, 0x20, ...tweakedKey]);

  // Build to_spend txid
  const toSpendTxid = bip322BuildToSpendTxId(message, scriptPubKey);

  // Compute BIP341 sighash manually for SIGHASH_DEFAULT (0x00) key-path spending.
  // hashPrevouts = SHA256(txid_wire_bytes || vout(4LE))
  //
  // @scure/btc-signer stores txid as-is but applies P.bytes(32, true) (reversing) when
  // encoding TxHashIdx for the BIP341 sighash computation. This means the wire-format txid
  // used in hashPrevouts is the reverse of what bip322BuildToSpendTxId returns.
  // We must re-reverse to produce the same bytes that btc-signer uses when signing.
  const txidForHashPrevouts = toSpendTxid.slice().reverse();
  const prevouts = concatBytes(txidForHashPrevouts, writeUint32LE(0));
  const hashPrevouts = hashSha256Sync(prevouts);

  // hashAmounts = SHA256(amount_8LE)  [amount = 0n for virtual input]
  const amounts = writeUint64LE(BigInt(0));
  const hashAmounts = hashSha256Sync(amounts);

  // hashScriptPubkeys = SHA256(varint(scriptPubKey.length) || scriptPubKey)
  const scriptPubKeyWithLen = concatBytes(
    encodeVarInt(scriptPubKey.length),
    scriptPubKey
  );
  const hashScriptPubkeys = hashSha256Sync(scriptPubKeyWithLen);

  // hashSequences = SHA256(sequence_4LE)  [sequence = 0]
  const sequences = writeUint32LE(0);
  const hashSequences = hashSha256Sync(sequences);

  // hashOutputs = SHA256(amount_8LE || varint(script.length) || script)
  // Output: amount=0n, script=OP_RETURN
  const opReturnScript = Script.encode(["RETURN"]);
  const outputBytes = concatBytes(
    writeUint64LE(BigInt(0)),
    encodeVarInt(opReturnScript.length),
    opReturnScript
  );
  const hashOutputs = hashSha256Sync(outputBytes);

  // sigMsg assembly (BIP341)
  const sigMsg = concatBytes(
    new Uint8Array([0x00]), // epoch
    new Uint8Array([0x00]), // hashType = SIGHASH_DEFAULT
    writeUint32LE(0), // nVersion = 0
    writeUint32LE(0), // nLockTime = 0
    hashPrevouts, // 32 bytes
    hashAmounts, // 32 bytes
    hashScriptPubkeys, // 32 bytes
    hashSequences, // 32 bytes
    hashOutputs, // 32 bytes
    new Uint8Array([0x00]), // spend_type = 0 (key-path, no annex)
    writeUint32LE(0) // input_index = 0
  );

  // tagged_hash("TapSighash", sigMsg) = SHA256(SHA256(tag) || SHA256(tag) || sigMsg)
  const tagBytes = new TextEncoder().encode("TapSighash");
  const tagHash = hashSha256Sync(tagBytes);
  const sighash = hashSha256Sync(concatBytes(tagHash, tagHash, sigMsg));

  return schnorr.verify(schnorrSig, sighash, tweakedKey);
}

// ---------------------------------------------------------------------------
// Main verification API
// ---------------------------------------------------------------------------

/**
 * Verify a Bitcoin message signature (BIP-137 or BIP-322).
 *
 * For BIP-137 (65-byte compact signatures from P2PKH/P2SH wallets):
 *   - Address is recovered from the signature — btcAddress parameter is optional
 *   - Returns the recovered address and public key
 *
 * For BIP-322 (witness-serialized signatures from bc1q/bc1p wallets):
 *   - btcAddress is required to reconstruct the virtual transaction
 *   - Returns the provided address and an empty publicKey string
 *
 * Signature format detection:
 *   - BIP-137: 65 bytes after base64 decode, first byte in range 27-42
 *   - BIP-322: everything else (encoded witness data)
 */
export function verifyBitcoinSignature(
  signature: string,
  message: string,
  btcAddress?: string
): {
  valid: boolean;
  address: string;
  publicKey: string;
} {
  // Decode signature (support both base64 and 130-char hex)
  let sigBytes: Uint8Array;
  if (signature.length === 130 && /^[0-9a-fA-F]+$/.test(signature)) {
    sigBytes = hex.decode(signature);
  } else {
    sigBytes = Uint8Array.from(Buffer.from(signature, "base64"));
  }

  if (isBip137Signature(sigBytes)) {
    // BIP-137 path: P2PKH (1...) / P2SH-P2WPKH (3...) / P2WPKH (bc1q) legacy wallets
    return verifyBip137(sigBytes, message);
  } else {
    // BIP-322 path: P2WPKH (bc1q) and P2TR (bc1p) native wallets
    if (!btcAddress) {
      throw new Error(
        "BIP-322 signature requires btcAddress parameter for verification"
      );
    }

    // Detect address type to route to correct BIP-322 verifier
    const isP2WPKH =
      btcAddress.startsWith("bc1q") || btcAddress.startsWith("tb1q");
    const isP2TR =
      btcAddress.startsWith("bc1p") || btcAddress.startsWith("tb1p");

    if (isP2WPKH) {
      try {
        const isValid = bip322VerifyP2WPKH(message, signature, btcAddress);
        return { valid: isValid, address: btcAddress, publicKey: "" };
      } catch {
        return { valid: false, address: btcAddress, publicKey: "" };
      }
    } else if (isP2TR) {
      try {
        const isValid = bip322VerifyP2TR(message, signature, btcAddress);
        return { valid: isValid, address: btcAddress, publicKey: "" };
      } catch {
        return { valid: false, address: btcAddress, publicKey: "" };
      }
    } else {
      throw new Error(
        `BIP-322 verification not supported for address type: ${btcAddress}`
      );
    }
  }
}

/**
 * Internal BIP-137 verification helper.
 * Recovers the address from the compact signature.
 */
function verifyBip137(
  sigBytes: Uint8Array,
  message: string
): {
  valid: boolean;
  address: string;
  publicKey: string;
} {
  if (sigBytes.length !== 65) {
    throw new Error(`Invalid signature length: ${sigBytes.length}`);
  }

  const header = sigBytes[0];
  const rBytes = sigBytes.slice(1, 33);
  const sBytes = sigBytes.slice(33, 65);
  const recoveryId = getRecoveryIdFromHeader(header);

  const formattedMsg = formatBitcoinMessage(message);
  const msgHash = doubleSha256(formattedMsg);

  const r = BigInt("0x" + hex.encode(rBytes));
  const s = BigInt("0x" + hex.encode(sBytes));

  const sig = new secp256k1.Signature(r, s).addRecoveryBit(recoveryId);
  const recoveredPoint = sig.recoverPublicKey(msgHash);
  const recoveredPubKey = recoveredPoint.toBytes(true);

  const valid = secp256k1.verify(
    sig.toBytes("compact"),
    msgHash,
    recoveredPubKey,
    { prehash: false }
  );

  // Derive address based on header byte:
  // 27-30: P2PKH uncompressed / 31-34: P2PKH compressed
  // 35-38: P2SH-P2WPKH (wrapped SegWit) -> p2sh(p2wpkh(...))
  // 39-42: P2WPKH native SegWit
  let address: string;
  if (header >= 27 && header <= 34) {
    address = p2pkh(recoveredPubKey, BTC_NETWORK).address!;
  } else if (header >= 35 && header <= 38) {
    const inner = p2wpkh(recoveredPubKey, BTC_NETWORK);
    address = p2sh(inner, BTC_NETWORK).address!;
  } else {
    // 39-42: P2WPKH
    address = p2wpkh(recoveredPubKey, BTC_NETWORK).address!;
  }

  return {
    valid,
    address,
    publicKey: hex.encode(recoveredPubKey),
  };
}
