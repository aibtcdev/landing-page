import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  grantAchievement,
  hasAchievement,
  getAchievementDefinition,
} from "@/lib/achievements";
import { getAgentLevel, type ClaimStatus } from "@/lib/levels";
import type { AgentRecord } from "@/lib/types";

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
            "Transaction ID (64-char hex) of sBTC transfer to verify for connector achievement",
        },
      },
      rateLimit: "1 check per address per 5 minutes",
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
          "https://api.hiro.so/extended/v1/address/{stxAddress}/transactions",
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

    // Look up agent and check rate limit in parallel
    const rateLimitKey = `ratelimit:achievement-verify:${btcAddress}`;
    const [agentData, lastCheck] = await Promise.all([
      kv.get(`btc:${btcAddress}`),
      kv.get(rateLimitKey),
    ]);

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
    if (lastCheck) {
      const elapsed = Date.now() - parseInt(lastCheck, 10);
      if (elapsed < RATE_LIMIT_MS) {
        const waitSecs = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);

        return NextResponse.json(
          {
            error: `Rate limited. Try again in ${waitSecs} seconds.`,
          },
          { status: 429 }
        );
      }
    }

    // Store rate limit timestamp
    await kv.put(rateLimitKey, String(Date.now()), {
      expirationTtl: 300, // auto-expire after 5 minutes
    });

    const checked: string[] = [];
    const earned: Array<{ id: string; name: string; unlockedAt: string }> = [];
    const alreadyHad: string[] = [];

    // Check sender achievement: BTC transactions from agent's address
    checked.push("sender");
    const hasSender = await hasAchievement(kv, btcAddress, "sender");

    if (!hasSender) {
      try {
        // Query mempool.space for transactions
        const mempoolUrl = `https://mempool.space/api/address/${btcAddress}/txs`;
        const mempoolResp = await fetch(mempoolUrl, {
          signal: AbortSignal.timeout(10000),
        });

        if (mempoolResp.ok) {
          const txs = (await mempoolResp.json()) as Array<{
            vin: Array<{ prevout: { scriptpubkey_address: string } }>;
          }>;

          // Check if agent's address appears in any transaction's vin (outgoing tx)
          const hasOutgoingTx = txs.some((tx) =>
            tx.vin.some(
              (input) => input.prevout.scriptpubkey_address === btcAddress
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
        // Continue to connector check even if sender fails
      }
    } else {
      alreadyHad.push("sender");
    }

    // Check connector achievement: sBTC transfers to registered agents
    // Only check if txid is provided
    if (txid) {
      checked.push("connector");
      const hasConnector = await hasAchievement(kv, btcAddress, "connector");

      if (!hasConnector) {
        try {
          // Fetch transaction from Stacks API
          const txUrl = `https://api.hiro.so/extended/v1/tx/${txid}`;
          const txResp = await fetch(txUrl, {
            signal: AbortSignal.timeout(10000),
          });

          if (!txResp.ok) {
            return NextResponse.json(
              {
                error: `Failed to fetch transaction ${txid}: ${txResp.status} ${txResp.statusText}`,
              },
              { status: 400 }
            );
          }

          const tx = (await txResp.json()) as {
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
