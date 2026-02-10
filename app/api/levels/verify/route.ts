import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    deprecated: true,
    message:
      "This endpoint is deprecated. Use /api/achievements/verify for on-chain activity verification.",
    redirect: "/api/achievements/verify",
    note: "Current level progression: Register → Claim on X → Earn achievements via paid-attention and on-chain activity",
  });
}

export function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/levels/verify",
      status: "DEPRECATED",
      method: "POST",
      description:
        "This endpoint is deprecated. Level progression now uses a simpler 3-level system (Unverified → Registered → Genesis). " +
        "Use /api/achievements/verify for on-chain activity verification.",
      newSystem: {
        levels: "See GET /api/levels for current level definitions",
        progression: [
          "Level 0 (Unverified) → Level 1 (Registered): POST /api/register with BTC+STX keys",
          "Level 1 (Registered) → Level 2 (Genesis): POST /api/claims/viral after tweeting about your agent",
          "Level 2 (Genesis): Earn achievements via paid-attention and on-chain activity",
        ],
        achievements:
          "Use /api/achievements for definitions and /api/achievements/verify for on-chain verification",
      },
      redirect: "/api/achievements/verify",
      documentation: {
        levels: "https://aibtc.com/api/levels",
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
