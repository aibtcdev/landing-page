#!/usr/bin/env tsx
/**
 * Operator-assisted STX address migration.
 *
 * Fixes agents who registered with a wrong STX address before #563 (when
 * signature-based address verification landed). Each agent still controls
 * their BTC key but registered an STX address they do not control.
 *
 * This script is intentionally a one-shot, run-locally tool rather than a
 * deployed admin endpoint. Persistent admin endpoints that can rewrite
 * `stx:{address}` pointers are a high-value target: if the admin key ever
 * leaks, an attacker can redirect inbox payments (dynamic payTo), vouch
 * history, and future achievements. Running the migration from an operator
 * workstation against the KV REST API keeps the blast radius bounded and
 * produces a git-committed audit trail (the input JSON file).
 *
 * The migration file format is a JSON array of MigrationEntry records. After
 * running --apply successfully, commit the input file under
 * scripts/migrations/ so the audit trail lives in the repo.
 *
 * Challenge message (signed by both keys):
 *   AIBTC STX Migration | btc={btc} | old={oldStx} | new={newStx} | date={iso}
 *
 * Required signatures per entry:
 *   - btcSignature — BIP-137 or BIP-322 signature from the agent's BTC key.
 *     Authorizes the change.
 *   - stxSignature — SIP-018/RSV signature from the NEW STX key. Proves the
 *     agent controls the destination address. The old STX key is never
 *     required; the agent does not control it.
 *
 * Usage:
 *   export CLOUDFLARE_ACCOUNT_ID=...
 *   export CLOUDFLARE_API_TOKEN=...    # needs Workers KV Storage:Edit scope
 *   npx tsx scripts/migrate-stx-address.ts scripts/migrations/stx-batch-01.json --dry-run
 *   npx tsx scripts/migrate-stx-address.ts scripts/migrations/stx-batch-01.json --apply
 */

import { readFileSync } from "node:fs";
import { verifyBitcoinSignature } from "../lib/bitcoin-verify";
import { hashMessage, verifyMessageSignatureRsv } from "@stacks/encryption";
import { bytesToHex } from "@stacks/common";
import {
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import type { AgentRecord } from "../lib/types";

const KV_NAMESPACE_ID = "f8aab2734e154953a50cabdb87083af3";
const AGENT_LIST_CACHE_KEY = "cache:agent-list";

interface MigrationEntry {
  btcAddress: string;
  oldStxAddress: string;
  newStxAddress: string;
  messageIso: string;
  btcSignature: string;
  stxSignature: string;
  notes: string;
}

function challengeMessage(e: MigrationEntry): string {
  return `AIBTC STX Migration | btc=${e.btcAddress} | old=${e.oldStxAddress} | new=${e.newStxAddress} | date=${e.messageIso}`;
}

async function kvFetch(
  key: string,
  method: "GET" | "PUT" | "DELETE",
  body?: string,
): Promise<string | null> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN env var",
    );
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });
  if (method === "GET") {
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`KV GET ${key} -> ${res.status} ${await res.text()}`);
    }
    return await res.text();
  }
  if (!res.ok) {
    throw new Error(`KV ${method} ${key} -> ${res.status} ${await res.text()}`);
  }
  return null;
}

function verifyStxSignature(
  sig: string,
  message: string,
): { valid: boolean; address: string; publicKey: string } {
  const messageHashHex = bytesToHex(hashMessage(message));
  const recoveredPubKey = publicKeyFromSignatureRsv(messageHashHex, sig);
  const recoveredAddress = getAddressFromPublicKey(recoveredPubKey, "mainnet");
  const valid = verifyMessageSignatureRsv({
    signature: sig,
    message,
    publicKey: recoveredPubKey,
  });
  return { valid, address: recoveredAddress, publicKey: recoveredPubKey };
}

async function migrateOne(entry: MigrationEntry, apply: boolean): Promise<void> {
  const message = challengeMessage(entry);
  console.log(`\n--- ${entry.btcAddress} (${entry.notes})`);

  const btc = verifyBitcoinSignature(
    entry.btcSignature,
    message,
    entry.btcAddress,
  );
  if (!btc.valid) {
    throw new Error(`BTC signature invalid for ${entry.btcAddress}`);
  }
  if (btc.address.toLowerCase() !== entry.btcAddress.toLowerCase()) {
    throw new Error(
      `BTC signature address mismatch: recovered ${btc.address}, expected ${entry.btcAddress}`,
    );
  }
  console.log("  OK BTC signature valid");

  const stx = verifyStxSignature(entry.stxSignature, message);
  if (!stx.valid) {
    throw new Error(`STX signature invalid for ${entry.newStxAddress}`);
  }
  if (stx.address !== entry.newStxAddress) {
    throw new Error(
      `STX signature address mismatch: recovered ${stx.address}, expected ${entry.newStxAddress}`,
    );
  }
  console.log("  OK STX signature valid (recovered address matches new STX)");

  const rawBtc = await kvFetch(`btc:${entry.btcAddress}`, "GET");
  if (!rawBtc) throw new Error(`btc:${entry.btcAddress} not found`);
  const agent = JSON.parse(rawBtc) as AgentRecord;

  if (agent.stxAddress !== entry.oldStxAddress) {
    throw new Error(
      `Current stxAddress on record (${agent.stxAddress}) does not match declared oldStxAddress (${entry.oldStxAddress}). Abort.`,
    );
  }
  const collision = await kvFetch(`stx:${entry.newStxAddress}`, "GET");
  if (collision) {
    throw new Error(
      `stx:${entry.newStxAddress} already exists and would collide with another agent. Abort.`,
    );
  }
  console.log("  OK Safety checks passed");

  const updated: AgentRecord = {
    ...agent,
    stxAddress: entry.newStxAddress,
    stxPublicKey: stx.publicKey,
  };

  if (!apply) {
    console.log("  [dry-run] Would write  stx:", entry.newStxAddress);
    console.log(
      "  [dry-run] Would update btc:",
      entry.btcAddress,
      "(stxAddress, stxPublicKey)",
    );
    console.log("  [dry-run] Would delete stx:", entry.oldStxAddress);
    return;
  }

  // Order: write forward pointer first (new stx resolves to agent), then
  // rewrite primary btc record, then delete stale pointer last. If the
  // script dies mid-way, re-running is idempotent as long as the first
  // step is still write-new before delete-old.
  await kvFetch(
    `stx:${entry.newStxAddress}`,
    "PUT",
    JSON.stringify(updated),
  );
  console.log("  OK wrote stx:", entry.newStxAddress);
  await kvFetch(`btc:${entry.btcAddress}`, "PUT", JSON.stringify(updated));
  console.log("  OK updated btc:", entry.btcAddress);
  await kvFetch(`stx:${entry.oldStxAddress}`, "DELETE");
  console.log("  OK deleted stx:", entry.oldStxAddress);
}

async function main(): Promise<void> {
  const [, , file, mode] = process.argv;
  if (!file || (mode !== "--dry-run" && mode !== "--apply")) {
    console.error(
      "Usage: npx tsx scripts/migrate-stx-address.ts <file.json> --dry-run|--apply",
    );
    process.exit(1);
  }
  const apply = mode === "--apply";
  const entries = JSON.parse(readFileSync(file, "utf8")) as MigrationEntry[];
  console.log(
    `Loaded ${entries.length} migration entries from ${file} (${apply ? "APPLY" : "DRY-RUN"})`,
  );

  let succeeded = 0;
  const failures: { entry: MigrationEntry; error: string }[] = [];
  for (const entry of entries) {
    try {
      await migrateOne(entry, apply);
      succeeded += 1;
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`  FAIL: ${msg}`);
      failures.push({ entry, error: msg });
    }
  }

  if (apply && succeeded > 0) {
    try {
      await kvFetch(AGENT_LIST_CACHE_KEY, "DELETE");
      console.log(`\nInvalidated ${AGENT_LIST_CACHE_KEY}`);
    } catch (err) {
      console.error(`\nCache invalidation failed: ${(err as Error).message}`);
    }
  }

  console.log(
    `\nDone: ${succeeded}/${entries.length} ${apply ? "applied" : "validated"}.`,
  );
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  - ${f.entry.btcAddress}: ${f.error}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
