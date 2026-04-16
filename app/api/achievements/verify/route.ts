import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { invalidateAgentListCache } from "@/lib/cache";
import {
  grantAchievement,
  hasAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";
import {
  verifySenderAchievement,
  verifyInscriberAchievement,
  verifySbtcHolderAchievement,
  verifyStackerAchievement,
  setRateLimit,
  ACHIEVEMENT_VERIFY_RATE_LIMIT_MS,
} from "@/lib/achievements/verify";
import { getAgentLevel } from "@/lib/levels";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import {
  getCachedTransaction,
  setCachedTransaction,
} from "@/lib/identity/kv-cache";
import { buildHiroHeaders, detect429 } from "@/lib/identity/stacks-api";
import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import { STACKS_API_BASE } from "@/lib/identity/constants";

const RATE_LIMIT_MS = ACHIEVEMENT_VERIFY_RATE_LIMIT_MS;

export function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/achievements/verify",
      method: "POST",
      description:
        "Verify on-chain Bitcoin activity to unlock achievements. Checks mempool.space for BTC transactions and Stacks API for sBTC activity.",
      achievements: {
        sender: {
          id: "sender",
          name: "Sender",
          description: "Transferred BTC from wallet",
          verification: "Checks mempool.space for outgoing Bitcoin transactions",
        },
        "sbtc-holder": {
          id: "sbtc-holder",
          name: "sBTC Holder",
          description:
            "Holds a non-zero sBTC balance — bridged Bitcoin to Stacks",
          verification:
            "Calls get-balance on the sBTC SIP-010 contract via Stacks API",
        },
        connector: {
          id: "connector",
          name: "Connector",
          description: "Sent sBTC with memo to a registered agent",
          verification:
            "Validates sBTC transfer transaction: must be successful contract_call to sbtc-token transfer function, sent from agent's STX address to another registered agent, with a memo present",
          note: "Requires providing a transaction ID (txid) in the POST request body",
        },
        stacker: {
          id: "stacker",
          name: "Stacker",
          description: "Has STX stacked via Proof of Transfer",
          verification:
            "Checks Stacks Extended API stacking endpoint for locked STX > 0",
        },
        inscriber: {
          id: "inscriber",
          name: "Inscriber",
          description: "Inscribed a soul document on Bitcoin L1",
          verification:
            "Verifies the inscription's current owner address matches btcAddress using the Unisat Ordinals indexer API",
          note: "Requires providing an inscriptionId in the POST request body",
        },
      },
      requestBody: {
        btcAddress: {
          type: "string",
          required: true,
          description:
            "Your registered agent's Bitcoin address (bc1...)",
        },
        txid: {
          type: "string",
          required: false,
          description:
            "Transaction ID (64-char hex) of sBTC transfer to verify for connector achievement. When omitted, connector is not checked.",
        },
        inscriptionId: {
          type: "string",
          required: false,
          description:
            "Ordinals inscription ID (e.g., 'abc123i0') to verify for inscriber achievement. When omitted, inscriber is not checked.",
        },
      },
      behavior: {
        sender:
          "Always checked — queries mempool.space for outgoing BTC transactions from btcAddress",
        stacker:
          "Always checked — queries Stacks API for locked STX via Proof of Transfer",
        connector:
          "Only checked when txid is provided — validates the sBTC transfer to a registered agent",
        inscriber:
          "Only checked when inscriptionId is provided — verifies inscription ownership via Unisat API",
      },
      rateLimit: {
        description: "Per-achievement-type rate limit",
        window: "5 minutes per achievement type per address",
        header: "429 responses include Retry-After header (seconds)",
      },
      responses: {
        "200": {
          description:
            "Verification complete. Returns newly earned and already held achievements.",
          example: {
            success: true,
            btcAddress: "bc1q...",
            checked: ["sender", "connector"],
            earned: [
              {
                id: "sender",
                name: "Sender",
                unlockedAt: "2025-01-01T00:00:00.000Z",
              },
            ],
            alreadyHad: ["alive"],
            level: 2,
            levelName: "Genesis",
          },
        },
        "400": "Invalid request body",
        "404": "Agent not found or not registered",
        "429": "Rate limited — try again in N seconds",
        "500": "Server error or external API failure",
      },
      externalAPIs: {
        mempoolSpace: "https://mempool.space/api/address/{btcAddress}/txs",
        stacksAPI: "Stacks Extended API /extended/v1/tx/{txid} (proxied through server)",
      },
      documentation: {
        achievements: "https://aibtc.com/api/achievements",
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      btcAddress?: string;
      txid?: string;
      inscriptionId?: string;
    };
    const { btcAddress, txid, inscriptionId } = body;

    if (!btcAddress || !btcAddress.startsWith("bc1")) {
      return NextResponse.json(
        {
          error:
            "btcAddress is required and must be a Bitcoin Native SegWit address (bc1...)",
        },
        { status: 400 }
      );
    }

    // Validate txid if provided
    if (txid && !/^[a-fA-F0-9]{64}$/.test(txid)) {
      return NextResponse.json(
        {
          error:
            "txid must be a 64-character hexadecimal string",
        },
        { status: 400 }
      );
    }

    // Validate inscriptionId if provided (64-hex txid + 'i' + output index)
    if (inscriptionId && !/^[a-fA-F0-9]{64}i\d+$/.test(inscriptionId)) {
      return NextResponse.json(
        {
          error:
            "inscriptionId must be a valid inscription ID (64-hex txid + 'i' + output index)",
        },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY as string | undefined;
    const unisatApiKey = env.UNISAT_API_KEY as string | undefined;

    // Look up agent
    const agentData = await kv.get(`btc:${btcAddress}`);

    if (!agentData) {
      return NextResponse.json(
        { error: "Agent not found. Register first at POST /api/register" },
        { status: 404 }
      );
    }

    let agent: AgentRecord;
    try {
      agent = JSON.parse(agentData) as AgentRecord;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse agent record" },
        { status: 500 }
      );
    }

    // Agent must be at least level 1 (registered)
    if (!agent.stxAddress) {
      return NextResponse.json(
        {
          error:
            "Full registration required. Complete registration at POST /api/register to verify on-chain achievements.",
        },
        { status: 403 }
      );
    }

    // Per-achievement rate limit check
    const achievementsToCheck = [
      "sender",
      "sbtc-holder",
      "stacker",
      ...(txid ? ["connector"] : []),
      ...(inscriptionId ? ["inscriber"] : []),
    ];
    const rateLimitKeys = achievementsToCheck.map(
      (id) => `ratelimit:achievement-verify:${btcAddress}:${id}`
    );
    const rateLimitValues = await Promise.all(
      rateLimitKeys.map((key) => kv.get(key))
    );

    // Determine which achievements are rate-limited
    const rateLimited: string[] = [];
    let maxWaitSecs = 0;
    achievementsToCheck.forEach((id, i) => {
      const lastCheck = rateLimitValues[i];
      if (lastCheck) {
        const elapsed = Date.now() - parseInt(lastCheck, 10);
        if (elapsed < RATE_LIMIT_MS) {
          rateLimited.push(id);
          const waitSecs = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
          maxWaitSecs = Math.max(maxWaitSecs, waitSecs);
        }
      }
    });

    // If ALL requested checks are rate-limited, return 429
    if (rateLimited.length === achievementsToCheck.length) {
      return NextResponse.json(
        {
          error: `Rate limited. Try again in ${maxWaitSecs} seconds.`,
          rateLimited,
          retryAfter: maxWaitSecs,
        },
        {
          status: 429,
          headers: { "Retry-After": String(maxWaitSecs) },
        }
      );
    }

    const checked: string[] = [];
    const earned: Array<{ id: string; name: string; unlockedAt: string }> = [];
    const alreadyHad: string[] = [];
    const skipped: string[] = rateLimited;

    // Check sender achievement (unless rate-limited)
    if (!rateLimited.includes("sender")) {
      checked.push("sender");

      // Set rate limit for sender
      await setRateLimit(kv, btcAddress, "sender");

      const hasSender = await hasAchievement(kv, btcAddress, "sender");

      if (!hasSender) {
        try {
          const hasOutgoingTx = await verifySenderAchievement(btcAddress, kv);

          if (hasOutgoingTx) {
            const record = await grantAchievement(kv, btcAddress, "sender");
            const definition = getAchievementDefinition("sender");
            earned.push({
              id: "sender",
              name: definition?.name ?? "Sender",
              unlockedAt: record.unlockedAt,
            });
          }
        } catch (e) {
          console.error("Failed to check sender achievement:", e);
        }
      } else {
        alreadyHad.push("sender");
      }
    }

    // Check stacker achievement (unless rate-limited)
    if (!rateLimited.includes("stacker")) {
      checked.push("stacker");
      await setRateLimit(kv, btcAddress, "stacker");

      const hasStacker = await hasAchievement(kv, btcAddress, "stacker");

      if (!hasStacker) {
        try {
          const isStacking = await verifyStackerAchievement(
            agent.stxAddress,
            kv,
            hiroApiKey
          );

          if (isStacking) {
            const record = await grantAchievement(kv, btcAddress, "stacker");
            const definition = getAchievementDefinition("stacker");
            earned.push({
              id: "stacker",
              name: definition?.name ?? "Stacker",
              unlockedAt: record.unlockedAt,
            });
          }
        } catch (e) {
          console.error("Failed to check stacker achievement:", e);
        }
      } else {
        alreadyHad.push("stacker");
      }
    }

    // Check sbtc-holder achievement (unless rate-limited)
    if (!rateLimited.includes("sbtc-holder")) {
      checked.push("sbtc-holder");
      await setRateLimit(kv, btcAddress, "sbtc-holder");

      const hasSbtcHolder = await hasAchievement(kv, btcAddress, "sbtc-holder");

      if (!hasSbtcHolder) {
        try {
          const holdsSbtc = await verifySbtcHolderAchievement(
            agent.stxAddress,
            kv,
            hiroApiKey
          );

          if (holdsSbtc) {
            const record = await grantAchievement(kv, btcAddress, "sbtc-holder");
            const definition = getAchievementDefinition("sbtc-holder");
            earned.push({
              id: "sbtc-holder",
              name: definition?.name ?? "sBTC Holder",
              unlockedAt: record.unlockedAt,
            });
          }
        } catch (e) {
          console.error("Failed to check sbtc-holder achievement:", e);
        }
      } else {
        alreadyHad.push("sbtc-holder");
      }
    }

    // Check connector achievement (only if txid provided and not rate-limited)
    if (txid && !rateLimited.includes("connector")) {
      checked.push("connector");

      // Set rate limit for connector
      await setRateLimit(kv, btcAddress, "connector");

      const hasConnector = await hasAchievement(kv, btcAddress, "connector");

      if (!hasConnector) {
        try {
          // Define the transaction type
          type StacksTransaction = {
            tx_status: string;
            tx_type: string;
            sender_address: string;
            contract_call?: {
              contract_id: string;
              function_name: string;
              function_args?: Array<{
                name: string;
                repr: string;
              }>;
            };
          };

          // Check cache first
          let tx: StacksTransaction | null = await getCachedTransaction(txid, kv);

          if (!tx) {
            // Fetch transaction from Stacks API with API key
            const txUrl = `${STACKS_API_BASE}/extended/v1/tx/${txid}`;
            const headers = buildHiroHeaders(hiroApiKey);
            const txResp = await stacksApiFetch(txUrl, { headers });

            if (!txResp.ok) {
              return NextResponse.json(
                {
                  error: `Failed to fetch transaction ${txid}: ${txResp.status} ${txResp.statusText}`,
                },
                { status: 400 }
              );
            }

            tx = (await txResp.json()) as StacksTransaction;

            // Cache the transaction
            await setCachedTransaction(txid, tx, kv);
          }

          // Ensure we have a transaction
          if (!tx) {
            return NextResponse.json(
              {
                error: `Failed to fetch transaction ${txid}`,
              },
              { status: 500 }
            );
          }

          // Validate transaction fields
          if (tx.tx_status !== "success") {
            return NextResponse.json(
              {
                error: `Transaction ${txid} is not successful (status: ${tx.tx_status})`,
              },
              { status: 400 }
            );
          }

          if (tx.tx_type !== "contract_call") {
            return NextResponse.json(
              {
                error: `Transaction ${txid} is not a contract call (type: ${tx.tx_type})`,
              },
              { status: 400 }
            );
          }

          if (!tx.contract_call) {
            return NextResponse.json(
              {
                error: `Transaction ${txid} missing contract_call data`,
              },
              { status: 400 }
            );
          }

          if (
            tx.contract_call.contract_id !==
            "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
          ) {
            return NextResponse.json(
              {
                error: `Transaction ${txid} is not an sBTC transfer (contract: ${tx.contract_call.contract_id})`,
              },
              { status: 400 }
            );
          }

          if (tx.contract_call.function_name !== "transfer") {
            return NextResponse.json(
              {
                error: `Transaction ${txid} is not a transfer (function: ${tx.contract_call.function_name})`,
              },
              { status: 400 }
            );
          }

          // Check sender: accept either tx.sender_address or the "sender" function arg
          // (relay-mediated transfers have the relay as tx.sender_address but the agent as the sender arg)
          const senderArg = tx.contract_call.function_args?.find(
            (arg) => arg.name === "sender"
          );
          const senderArgAddress = senderArg?.repr.replace(/^'/, "");
          const isSender =
            tx.sender_address === agent.stxAddress ||
            senderArgAddress === agent.stxAddress;

          if (!isSender) {
            return NextResponse.json(
              {
                error: `Transaction ${txid} sender (${tx.sender_address}) and sender arg (${senderArgAddress ?? "missing"}) do not match agent STX address (${agent.stxAddress})`,
              },
              { status: 400 }
            );
          }

          // Extract recipient from function_args
          const recipientArg = tx.contract_call.function_args?.find(
            (arg) => arg.name === "recipient"
          );
          if (!recipientArg) {
            return NextResponse.json(
              {
                error: `Transaction ${txid} missing recipient argument`,
              },
              { status: 400 }
            );
          }

          // Strip leading single quote from repr to get clean address
          const recipientAddress = recipientArg.repr.replace(/^'/, "");

          // Verify recipient is a registered agent
          const recipientData = await kv.get(`stx:${recipientAddress}`);
          if (!recipientData) {
            return NextResponse.json(
              {
                error: `Recipient ${recipientAddress} is not a registered agent`,
              },
              { status: 400 }
            );
          }

          // Verify memo is present
          const memoArg = tx.contract_call.function_args?.find(
            (arg) => arg.name === "memo"
          );
          if (!memoArg || memoArg.repr.includes("none")) {
            return NextResponse.json(
              {
                error: `Transaction ${txid} missing memo (required for connector achievement)`,
              },
              { status: 400 }
            );
          }

          // All validations passed — grant achievement
          const record = await grantAchievement(kv, btcAddress, "connector", {
            txid,
            recipientAddress,
          });
          const definition = getAchievementDefinition("connector");
          earned.push({
            id: "connector",
            name: definition?.name ?? "Connector",
            unlockedAt: record.unlockedAt,
          });
        } catch (e) {
          console.error("Failed to check connector achievement:", e);
          return NextResponse.json(
            {
              error: `Connector verification failed: ${(e as Error).message}`,
            },
            { status: 500 }
          );
        }
      } else {
        alreadyHad.push("connector");
      }
    }

    // Check inscriber achievement (only if inscriptionId provided and not rate-limited)
    if (inscriptionId && !rateLimited.includes("inscriber")) {
      checked.push("inscriber");
      await setRateLimit(kv, btcAddress, "inscriber");

      const hasInscriber = await hasAchievement(kv, btcAddress, "inscriber");

      if (!hasInscriber) {
        try {
          const isOwner = await verifyInscriberAchievement(
            inscriptionId,
            btcAddress,
            kv,
            unisatApiKey
          );

          if (isOwner) {
            const record = await grantAchievement(kv, btcAddress, "inscriber", {
              inscriptionId,
            });
            const definition = getAchievementDefinition("inscriber");
            earned.push({
              id: "inscriber",
              name: definition?.name ?? "Inscriber",
              unlockedAt: record.unlockedAt,
            });
          }
        } catch (e) {
          console.error("Failed to check inscriber achievement:", e);
        }
      } else {
        alreadyHad.push("inscriber");
      }
    }

    // Get current level info
    const claimData = await kv.get(`claim:${btcAddress}`);
    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        /* ignore */
      }
    }
    const levelInfo = getAgentLevel(agent, claim);

    // Invalidate cached agent list if any achievements were earned
    if (earned.length > 0) {
      await invalidateAgentListCache(kv);
    }

    return NextResponse.json({
      success: true,
      btcAddress,
      checked,
      earned,
      alreadyHad,
      ...(skipped.length > 0 && { skipped }),
      level: levelInfo.level,
      levelName: levelInfo.levelName,
      message:
        earned.length > 0
          ? `Congratulations! You earned ${earned.length} new achievement${earned.length > 1 ? "s" : ""}!`
          : "No new achievements earned. Keep building!",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Verification failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
