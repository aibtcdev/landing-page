/**
 * Install guidance for aibtcdev/skills.
 *
 * Every skill runs when installed on its own (aibtcdev/skills#473, #482):
 * `npx skills add aibtcdev/skills/<skill>` copies the skill's folder,
 * including a generated package.json, and one `bun install` in that folder
 * fetches its npm packages and the shared code. skills.json lists
 * `"install": "bun install"` on every skill that needs that step; doc-only
 * skills omit it and need only the npx step. A full checkout of the repo
 * still works as the alternative for using many skills at once.
 *
 * Used by /skills, /skills/md, llms.txt and llms-full.txt.
 */

export const SKILLS_MANIFEST_URL =
  "https://raw.githubusercontent.com/aibtcdev/skills/main/skills.json";

export const SKILLS_INSTALL_URL = "https://github.com/aibtcdev/skills#installation";

export const SKILLS_CLONE_COMMAND =
  "git clone https://github.com/aibtcdev/skills.git && cd skills";

export const SKILLS_INSTALL_COMMAND = "bun install";

/** Where `npx skills add` puts a skill by default (with -g: ~/.agents/skills/<skill>). */
export function skillFolder(name: string): string {
  return `.agents/skills/${name}`;
}

/**
 * Install + run lines for one skill from its skills.json entry: the npx step,
 * then (when the skill has an `install` field) `bun install` inside the
 * installed folder and a `--help` run of each entry file.
 */
export function skillInstallCommands(skill: {
  name: string;
  entry: string | string[];
  install?: string;
}): string[] {
  const lines = [`npx skills add aibtcdev/skills/${skill.name}`];
  if (!skill.install) return lines;
  lines.push(`cd ${skillFolder(skill.name)} && ${skill.install}`);
  const entries = Array.isArray(skill.entry) ? skill.entry : [skill.entry];
  for (const e of entries) {
    if (!/\.(ts|js)$/.test(e)) continue;
    // Inside the installed folder the entry is the path after "<skill>/".
    lines.push(`bun run ${e.slice(e.indexOf("/") + 1)} --help`);
  }
  return lines;
}

/**
 * Markdown install section for llms.txt, llms-full.txt and /skills/md.
 * Agents follow these docs literally, so the bun install step is spelled out.
 */
export const SKILLS_INSTALL_MARKDOWN = [
  "Install a skill in two steps. Bun is required (https://bun.sh):",
  "",
  "```",
  "npx skills add aibtcdev/skills/{skill-name}",
  "cd .agents/skills/{skill-name}   # the folder the installer reports (-g: ~/.agents/skills/{skill-name})",
  SKILLS_INSTALL_COMMAND,
  "bun run {skill-name}.ts --help",
  "```",
  "",
  `Run \`${SKILLS_INSTALL_COMMAND}\` inside the installed skill folder. It installs the skill's npm packages and the shared code from GitHub; without it the skill fails with "Cannot find module". Skills without an \`install\` field in skills.json are doc-only and need only the npx step. \`npx skills add aibtcdev/skills\` installs every skill the same way: run \`${SKILLS_INSTALL_COMMAND}\` in each skill folder you use.`,
  "",
  "Alternative, for using many skills at once: a full checkout. Every skill then runs from the repo root:",
  "",
  "```",
  SKILLS_CLONE_COMMAND,
  SKILLS_INSTALL_COMMAND,
  "bun run {skill-name}/{skill-name}.ts --help",
  "```",
  "",
  `Install guide: ${SKILLS_INSTALL_URL}`,
].join("\n");
