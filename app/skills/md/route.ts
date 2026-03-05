import { NextResponse } from "next/server";

interface Skill {
  name: string;
  description: string;
  entry: string | string[];
  arguments: string[];
  requires: string[];
  tags: string[];
  userInvocable: boolean;
}

interface SkillsData {
  version: string;
  generated: string;
  skills: Skill[];
}

const SKILLS_URL =
  "https://raw.githubusercontent.com/aibtcdev/skills/main/skills.json";

function toMarkdown(data: SkillsData): string {
  const lines: string[] = [
    "# AIBTC Agent Skills",
    "",
    `> ${data.skills.length} skills | v${data.version}`,
    "",
    "Install all skills:",
    "```",
    "npx skills add aibtcdev/skills",
    "```",
    "",
  ];

  for (const skill of data.skills) {
    const entries = Array.isArray(skill.entry) ? skill.entry : [skill.entry];

    lines.push(`## ${skill.name}`);
    lines.push("");
    lines.push(skill.description);
    lines.push("");
    lines.push("```");
    lines.push(`npx skills add aibtcdev/skills/${skill.name}`);
    lines.push("```");
    lines.push("");

    if (skill.tags.length > 0) {
      lines.push(`**Tags:** ${skill.tags.join(", ")}`);
    }
    lines.push(`**Entry:** ${entries.map((e) => `\`${e}\``).join(", ")}`);
    if (skill.requires.length > 0) {
      lines.push(`**Requires:** ${skill.requires.join(", ")}`);
    }
    if (skill.arguments.length > 0) {
      lines.push(
        `**Commands:** ${skill.arguments.map((a) => `\`${a}\``).join(", ")}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function GET() {
  try {
    const res = await fetch(SKILLS_URL, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return new NextResponse("Failed to fetch skills data", { status: 502 });
    }

    const data = (await res.json()) as SkillsData;
    const md = toMarkdown(data);

    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        Vary: "User-Agent",
      },
    });
  } catch {
    return new NextResponse("Error generating skills markdown", {
      status: 500,
    });
  }
}
