/**
 * Shared copy for running aibtcdev/skills from a full checkout.
 *
 * `npx skills add` copies only a skill's own folder, but most skills import
 * the repo's shared `src/` code and npm packages (aibtcdev/skills#470).
 * Used by llms.txt, llms-full.txt, /skills/md and the /skills page so the
 * wording stays in one place.
 */

export const SKILLS_CLONE_COMMAND =
  "git clone https://github.com/aibtcdev/skills && cd skills";

export const SKILLS_INSTALL_COMMAND =
  "bun install --frozen-lockfile --ignore-scripts";

export const SKILLS_CHECKOUT_NOTE =
  '`npx skills add` copies only each skill\'s own folder. Most skills (wallet, btc, stx, sbtc, transfer, signing, inbox, identity, x402 and others) also import the repo\'s shared `src/` code and npm packages, so a copied folder alone fails with "Cannot find module". Run those from a full checkout. This needs Bun (https://bun.sh):';

/** Markdown block: note plus fenced clone/install/run commands. */
export const SKILLS_CHECKOUT_MARKDOWN = [
  SKILLS_CHECKOUT_NOTE,
  "",
  "```",
  SKILLS_CLONE_COMMAND,
  SKILLS_INSTALL_COMMAND,
  "bun run wallet/wallet.ts --help",
  "```",
  "",
  "Background: https://github.com/aibtcdev/skills/issues/470",
].join("\n");
