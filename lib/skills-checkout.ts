/**
 * Install guidance for aibtcdev/skills.
 *
 * `npx skills add aibtcdev/skills/<skill>` copies only that skill's folder
 * (SKILL.md, AGENT.md, its .ts entry). The skills listed in
 * FULL_CHECKOUT_SKILLS import the repo's shared `src/lib/` runtime and npm
 * packages, so a copied folder crashes with "Cannot find module". They only
 * run from a full checkout (aibtcdev/skills#470).
 *
 * This is the single list used by /skills, /skills/md, llms.txt and
 * llms-full.txt. It mirrors the skills whose SKILL.md carries the
 * "Runs from a full checkout." note. Update or remove it when
 * aibtcdev/skills#473 (publish the shared runtime as an npm package) lands.
 *
 * TODO: /skills and /skills/md already read skills.json. Once the manifest
 * marks these skills itself (e.g. `"standalone": false`), read that field
 * there instead of this list.
 */

export const FULL_CHECKOUT_SKILLS: ReadonlySet<string> = new Set([
  "agent-lookup",
  "bitflow",
  "bns",
  "bounty-scanner",
  "btc",
  "business-dev",
  "child-inscription",
  "contract",
  "credentials",
  "defi",
  "dual-stacking",
  "erc8004",
  "identity",
  "inbox",
  "jingswap",
  "jingswap-v2",
  "launkr",
  "lunarcrush",
  "mempool-watch",
  "nft",
  "nonce-manager",
  "nostr",
  "onboarding",
  "openrouter",
  "ordinals",
  "ordinals-p2p",
  "pillar",
  "psbt",
  "query",
  "relay-diagnostic",
  "reputation",
  "runes",
  "sbtc",
  "sbtc-yield-maximizer",
  "settings",
  "signing",
  "souldinals",
  "stacking",
  "stacking-lottery",
  "stacks-market",
  "stackspot",
  "stx",
  "styx",
  "taproot-multisig",
  "tenero",
  "tokens",
  "transfer",
  "validation",
  "vibewatch-sentiment",
  "wallet",
  "x402",
  "yield-dashboard",
  "yield-hunter",
]);

export function needsFullCheckout(skillName: string): boolean {
  return FULL_CHECKOUT_SKILLS.has(skillName);
}

export const SKILLS_INSTALL_URL = "https://github.com/aibtcdev/skills#installation";

export const SKILLS_CLONE_COMMAND =
  "git clone https://github.com/aibtcdev/skills.git && cd skills";

export const SKILLS_INSTALL_COMMAND =
  "bun install --frozen-lockfile --ignore-scripts";

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
export const SKILLS_INSTALL_MARKDOWN = [
  "Default: run AIBTC skills from a full checkout of the repo. This needs Bun (https://bun.sh):",
  "",
  "```",
  SKILLS_CLONE_COMMAND,
  SKILLS_INSTALL_COMMAND,
  "bun run {skill-name}/{skill-name}.ts --help",
  "```",
  "",
  `\`npx skills add aibtcdev/skills/{skill-name}\` (and \`npx skills add aibtcdev/skills\`) copies only each skill's own folder. Per-skill install works ONLY for skills whose SKILL.md has no "Runs from a full checkout." note. These ${FULL_CHECKOUT_SKILLS.size} skills import the repo's shared \`src/lib/\` runtime and npm packages, crash with "Cannot find module" when installed that way, and must run from the checkout above:`,
  "",
  [...FULL_CHECKOUT_SKILLS].join(", "),
  "",
  `Install guide: ${SKILLS_INSTALL_URL}`,
].join("\n");
