/**
 * Install guidance for aibtcdev/skills.
 *
 * `npx skills add aibtcdev/skills/<skill>` (and `npx skills add
 * aibtcdev/skills`) copies only each skill's folder (SKILL.md, AGENT.md, its
 * .ts entry). Skills that import the repo's shared `src/lib/` runtime and npm
 * packages crash with "Cannot find module" when copied that way and only run
 * from a full checkout (aibtcdev/skills#470).
 *
 * The manifest marks them: every skills.json entry has `standalone: boolean`
 * (aibtcdev/skills#475), false meaning "runs only from a full checkout".
 * /skills and /skills/md read it from the manifest they already load;
 * llms.txt and llms-full.txt fetch it via fetchFullCheckoutSkills().
 * Revisit all of this when aibtcdev/skills#473 (publish the shared runtime
 * as an npm package) lands.
 */

export const SKILLS_MANIFEST_URL =
  "https://raw.githubusercontent.com/aibtcdev/skills/main/skills.json";

export const SKILLS_INSTALL_URL = "https://github.com/aibtcdev/skills#installation";

export const SKILLS_CLONE_COMMAND =
  "git clone https://github.com/aibtcdev/skills.git && cd skills";

export const SKILLS_INSTALL_COMMAND = "bun install --ignore-scripts";

/** A skill missing the `standalone` field is treated as needing a full checkout. */
export function needsFullCheckout(skill: { standalone?: boolean }): boolean {
  return skill.standalone !== true;
}

/**
 * Fallback only, for when skills.json can't be fetched: the skills marked
 * `standalone: false` as of skills v0.44.0.
 */
export const FULL_CHECKOUT_SKILLS_FALLBACK: readonly string[] = [
  "agent-lookup", "bitflow", "bns", "bounty-scanner", "btc", "business-dev",
  "child-inscription", "contract", "credentials", "defi", "dual-stacking",
  "erc8004", "identity", "inbox", "jingswap", "jingswap-v2", "launkr",
  "lunarcrush", "mempool-watch", "nft", "nonce-manager", "nostr", "onboarding",
  "openrouter", "ordinals", "ordinals-p2p", "pillar", "psbt", "query",
  "relay-diagnostic", "reputation", "runes", "sbtc", "sbtc-yield-maximizer",
  "settings", "signing", "souldinals", "stacking", "stacking-lottery",
  "stacks-market", "stackspot", "stx", "styx", "taproot-multisig", "tenero",
  "tokens", "transfer", "validation", "vibewatch-sentiment", "wallet", "x402",
  "yield-dashboard", "yield-hunter",
];

/** Names of skills that need a full checkout, from skills.json (same caching as /skills/md). */
export async function fetchFullCheckoutSkills(): Promise<readonly string[]> {
  try {
    const res = await fetch(SKILLS_MANIFEST_URL, { next: { revalidate: 3600 } });
    if (!res.ok) return FULL_CHECKOUT_SKILLS_FALLBACK;
    const data = (await res.json()) as {
      skills?: Array<{ name: string; standalone?: boolean }>;
    };
    if (!Array.isArray(data.skills)) return FULL_CHECKOUT_SKILLS_FALLBACK;
    return data.skills.filter(needsFullCheckout).map((s) => s.name);
  } catch {
    return FULL_CHECKOUT_SKILLS_FALLBACK;
  }
}

/** Clone, install and `--help` lines for one skill's entry file(s). */
export function fullCheckoutCommands(entries: string[]): string[] {
  return [
    SKILLS_CLONE_COMMAND,
    SKILLS_INSTALL_COMMAND,
    ...entries.map((e) => `bun run ${e} --help`),
  ];
}

/**
 * Markdown install section for llms.txt, llms-full.txt and /skills/md.
 * Leads with the full checkout because agents follow these docs literally.
 */
export function skillsInstallMarkdown(fullCheckoutSkills: readonly string[]): string {
  return [
    "Default: run AIBTC skills from a full checkout of the repo. This needs Bun (https://bun.sh):",
    "",
    "```",
    SKILLS_CLONE_COMMAND,
    SKILLS_INSTALL_COMMAND,
    "bun run {skill-name}/{skill-name}.ts --help",
    "```",
    "",
    `\`npx skills add aibtcdev/skills/{skill-name}\` (and \`npx skills add aibtcdev/skills\`) copies only each skill's own folder. Per-skill install works ONLY for skills whose SKILL.md has no "Runs from a full checkout." note (\`standalone: true\` in skills.json). These ${fullCheckoutSkills.length} skills import the repo's shared \`src/lib/\` runtime and npm packages, crash with "Cannot find module" when installed that way, and must run from the checkout above:`,
    "",
    fullCheckoutSkills.join(", "),
    "",
    `Install guide: ${SKILLS_INSTALL_URL}`,
  ].join("\n");
}
