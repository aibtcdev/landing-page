import { NextResponse } from "next/server";

const SKILLS_JSON_URL =
  "https://raw.githubusercontent.com/aibtcdev/skills/main/skills.json";

/**
 * Proxy the skills.json manifest from the aibtcdev/skills repo on GitHub.
 *
 * Returns the machine-readable skills directory at aibtc.com/skills so agents
 * can discover all available skills without following a redirect.
 */
export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(SKILLS_JSON_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "aibtc.com/skills-proxy",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Failed to fetch skills manifest from upstream",
          source: SKILLS_JSON_URL,
          status: response.status,
        },
        { status: 502 }
      );
    }

    const body = await response.text();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "X-Skills-Source": SKILLS_JSON_URL,
      },
    });
  } catch (err) {
    const isTimeout = (err as Error).name === "AbortError";
    return NextResponse.json(
      {
        error: isTimeout
          ? "Skills manifest fetch timed out"
          : "Failed to fetch skills manifest",
        source: SKILLS_JSON_URL,
        hint: `Fetch the manifest directly from ${SKILLS_JSON_URL}`,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
