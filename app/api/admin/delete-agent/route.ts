import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { lookupAgent } from "@/lib/agent-lookup";
import type { AchievementAgentIndex } from "@/lib/achievements/types";
import type { AttentionAgentIndex } from "@/lib/attention/types";
import type { InboxAgentIndex } from "@/lib/inbox/types";

/** Safely parse JSON, returning null on failure. */
function safeParseJson<T>(data: string | null, label: string): T | null {
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch (e) {
    console.error(`Failed to parse ${label}:`, e);
    return null;
  }
}

/**
 * GET /api/admin/delete-agent
 *
 * Self-documenting endpoint description for the delete-agent admin route.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return NextResponse.json({
    endpoint: "/api/admin/delete-agent",
    description:
      "Delete an agent and all associated KV data. Use this to fully remove an agent from the system (e.g., lost keys, test cleanup).",
    methods: ["GET", "DELETE"],
    authentication: "Requires X-Admin-Key header",
    delete: {
      body: {
        address:
          "BTC (bc1...) or STX (SP...) address to delete. Will be resolved to full AgentRecord.",
      },
      behavior: [
        "Resolves address to AgentRecord (404 if not found)",
        "Reads all index records to discover related KV keys",
        "Deletes all keys across 7 categories in parallel batches",
        "Returns categorized summary of deleted keys",
      ],
      deletedKeyPatterns: {
        core: ["btc:{btcAddress}", "stx:{stxAddress}"],
        claims: [
          "claim:{btcAddress}",
          "claim-code:{btcAddress}",
          "owner:{twitterHandle}",
        ],
        genesis: ["genesis:{btcAddress}"],
        challenges: [
          "challenge:{btcAddress}",
          "checkin:{btcAddress}",
          "ratelimit:achievement-verify:{btcAddress}",
        ],
        achievements: [
          "achievements:{btcAddress}",
          "achievement:{btcAddress}:{achievementId}",
        ],
        attention: [
          "attention:agent:{btcAddress}",
          "attention:response:{messageId}:{btcAddress}",
          "attention:payout:{messageId}:{btcAddress}",
        ],
        inbox: [
          "inbox:agent:{btcAddress}",
          "inbox:message:{messageId}",
          "inbox:reply:{messageId}",
        ],
      },
      returns: {
        success: true,
        address: "bc1q...",
        deleted: {
          core: ["btc:...", "stx:..."],
          claims: ["claim:...", "claim-code:...", "owner:..."],
          genesis: ["genesis:..."],
          challenges: [
            "challenge:...",
            "checkin:...",
            "ratelimit:achievement-verify:...",
          ],
          achievements: ["achievements:...", "achievement:...:sender"],
          attention: [
            "attention:agent:...",
            "attention:response:msg1:...",
            "attention:payout:msg1:...",
          ],
          inbox: [
            "inbox:agent:...",
            "inbox:message:msg1",
            "inbox:reply:msg1",
          ],
        },
        summary: {
          totalKeys: 17,
          categories: {
            core: 2,
            claims: 3,
            genesis: 1,
            challenges: 3,
            achievements: 2,
            attention: 3,
            inbox: 3,
          },
        },
      },
    },
  });
}

/**
 * DELETE /api/admin/delete-agent
 *
 * Delete an agent and all associated KV data.
 */
export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body" },
        { status: 400 }
      );
    }

    const address =
      body && typeof body === "object" && "address" in body
        ? (body as { address: unknown }).address
        : undefined;

    if (typeof address !== "string" || address.trim() === "") {
      return NextResponse.json(
        {
          error: "Missing required field",
          details: "Body must include 'address' (non-empty BTC or STX address)",
        },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Resolve address to AgentRecord
    const agent = await lookupAgent(kv, address);
    if (!agent) {
      return NextResponse.json(
        {
          error: "Agent not found",
          details: `No agent found for address: ${address}`,
        },
        { status: 404 }
      );
    }

    // Read index records in parallel to discover related keys
    const [achievementData, attentionData, inboxData] = await Promise.all([
      kv.get(`achievements:${agent.btcAddress}`),
      kv.get(`attention:agent:${agent.btcAddress}`),
      kv.get(`inbox:agent:${agent.btcAddress}`),
    ]);

    const achievementIndex = safeParseJson<AchievementAgentIndex>(
      achievementData,
      "achievement index"
    );
    const attentionIndex = safeParseJson<AttentionAgentIndex>(
      attentionData,
      "attention index"
    );
    const inboxIndex = safeParseJson<InboxAgentIndex>(
      inboxData,
      "inbox index"
    );

    // Fail if any index record exists but is corrupted — partial deletion is worse than no deletion
    if (achievementData && !achievementIndex) {
      return NextResponse.json(
        {
          error: "Internal Server Error",
          details:
            "Corrupted achievement index data; deletion cannot be safely completed.",
        },
        { status: 500 }
      );
    }
    if (attentionData && !attentionIndex) {
      return NextResponse.json(
        {
          error: "Internal Server Error",
          details:
            "Corrupted attention index data; deletion cannot be safely completed.",
        },
        { status: 500 }
      );
    }
    if (inboxData && !inboxIndex) {
      return NextResponse.json(
        {
          error: "Internal Server Error",
          details:
            "Corrupted inbox index data; deletion cannot be safely completed.",
        },
        { status: 500 }
      );
    }

    // Build categorized key lists
    const coreKeys = [`btc:${agent.btcAddress}`];
    if (
      typeof agent.stxAddress === "string" &&
      agent.stxAddress.trim() !== ""
    ) {
      coreKeys.push(`stx:${agent.stxAddress}`);
    }

    const keysToDelete = {
      core: coreKeys,
      claims: [
        `claim:${agent.btcAddress}`,
        `claim-code:${agent.btcAddress}`,
        ...(agent.owner ? [`owner:${agent.owner.toLowerCase()}`] : []),
      ],
      genesis: [`genesis:${agent.btcAddress}`],
      challenges: [
        `challenge:${agent.btcAddress}`,
        `checkin:${agent.btcAddress}`,
        `ratelimit:achievement-verify:${agent.btcAddress}`,
      ],
      achievements: [
        `achievements:${agent.btcAddress}`,
        ...(achievementIndex?.achievementIds.map(
          (id) => `achievement:${agent.btcAddress}:${id}`
        ) || []),
      ],
      attention: [
        `attention:agent:${agent.btcAddress}`,
        ...(attentionIndex?.messageIds.flatMap((msgId) => [
          `attention:response:${msgId}:${agent.btcAddress}`,
          `attention:payout:${msgId}:${agent.btcAddress}`,
        ]) || []),
      ],
      inbox: [
        `inbox:agent:${agent.btcAddress}`,
        ...(inboxIndex?.messageIds.flatMap((msgId) => [
          `inbox:message:${msgId}`,
          `inbox:reply:${msgId}`,
        ]) || []),
      ],
    };

    // Delete all keys in parallel batches
    // KV delete is idempotent, so it's safe to delete non-existent keys (like TTL keys)
    const allKeys = Object.values(keysToDelete).flat();
    const BATCH_SIZE = 20;

    for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
      const batch = allKeys.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((key) => kv.delete(key)));
    }

    // Calculate summary stats
    const totalKeys = allKeys.length;
    const categoryCounts = Object.fromEntries(
      Object.entries(keysToDelete).map(([category, keys]) => [
        category,
        keys.length,
      ])
    );

    return NextResponse.json({
      success: true,
      address: agent.btcAddress,
      deleted: keysToDelete,
      summary: {
        totalKeys,
        categories: categoryCounts,
      },
    });
  } catch (e) {
    console.error("DELETE /api/admin/delete-agent error:", e);
    return NextResponse.json(
      { error: `Failed to delete agent: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
