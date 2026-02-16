import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  grantAchievement,
  hasAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";
import { getAgentLevel, type ClaimStatus } from "@/lib/levels";
import type { AgentRecord } from "@/lib/types";
import {
  getCachedTransaction,
  setCachedTransaction,
} from "@/lib/identity/kv-cache";
import { buildHiroHeaders, detect429AndFallback } from "@/lib/identity/stacks-api";

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

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
        connector: {
          id: "connector",
          name: "Connector",
          description: "Sent sBTC with memo to a registered agent",
          verification:
            "Validates sBTC transfer transaction: must be successful contract_call to sbtc-token transfer function, sent from agent's STX address to another registered agent, with a memo present",
          note: "Requires providing a transaction ID (txid) in the POST request body",
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
            "Transaction ID (64-char hex) of sBTC transfer to verify for connector achievement. When omitted, only the sender achievement is checked.",
        },
      },
      behavior: {
        sender:
          "Always checked — queries mempool.space for outgoing BTC transactions from btcAddress",
        connector:
          "Only checked when txid is provided — validates the sBTC transfer to a registered agent",
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
        stacksAPI:
          "https://api.hiro.so/extended/v1/tx/{txid}",
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
    };
    const { btcAddress, txid } = body;

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

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY as string | undefined;

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
    const achievementsToCheck = ["sender", ...(txid ? ["connector"] : [])];
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
      await kv.put(
        `ratelimit:achievement-verify:${btcAddress}:sender`,
        String(Date.now()),
        { expirationTtl: 300 }
      );

      const hasSender = await hasAchievement(kv, btcAddress, "sender");

      if (!hasSender) {
        try {
          // Check cache first
          const cacheKey = `mempool:${btcAddress}`;
          let txs = await getCachedTransaction(cacheKey, kv);

          if (!txs) {
            const mempoolUrl = `https://mempool.space/api/address/${btcAddress}/txs`;
            const mempoolResp = await fetch(mempoolUrl, {
              signal: AbortSignal.timeout(10000),
            });

            if (mempoolResp.ok) {
              txs = (await mempoolResp.json()) as Array<{
                vin: Array<{ prevout: { scriptpubkey_address: string } }>;
              }>;
              // Cache the result
              await setCachedTransaction(cacheKey, txs, kv);
            }
          }

          if (txs) {
            const hasOutgoingTx = txs.some((tx: any) =>
              tx.vin.some(
                (input: any) => input.prevout.scriptpubkey_address === btcAddress
              )
            );

            if (hasOutgoingTx) {
              const record = await grantAchievement(kv, btcAddress, "sender");
              const definition = getAchievementDefinition("sender");
              earned.push({
                id: "sender",
                name: definition?.name ?? "Sender",
                unlockedAt: record.unlockedAt,
              });
            }
          }
        } catch (e) {
          console.error("Failed to check sender achievement:", e);
        }
      } else {
        alreadyHad.push("sender");
      }
    }

    // Check connector achievement (only if txid provided and not rate-limited)
    if (txid && !rateLimited.includes("connector")) {
      checked.push("connector");

      // Set rate limit for connector
      await kv.put(
        `ratelimit:achievement-verify:${btcAddress}:connector`,
        String(Date.now()),
        { expirationTtl: 300 }
      );

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
            const txUrl = `https://api.hiro.so/extended/v1/tx/${txid}`;
            const headers = buildHiroHeaders(hiroApiKey);
            const txResp = await fetch(txUrl, {
              headers,
              signal: AbortSignal.timeout(10000),
            });

            // Check for rate limiting
            const rateLimitCheck = detect429AndFallback(txResp);
            if (rateLimitCheck.isRateLimited) {
              return NextResponse.json(
                {
                  error: `Stacks API rate limited. Try again later.`,
                  retryAfter: 60,
                },
                {
                  status: 503,
                  headers: { "Retry-After": "60" },
                }
              );
            }

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

          if (tx.sender_address !== agent.stxAddress) {
            return NextResponse.json(
              {
                error: `Transaction ${txid} sender (${tx.sender_address}) does not match agent STX address (${agent.stxAddress})`,
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
