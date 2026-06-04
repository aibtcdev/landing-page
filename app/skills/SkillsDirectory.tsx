"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import CopyButton from "@/app/components/CopyButton";

/* ─── Types ─── */

export interface Skill {
  name: string;
  description: string;
  entry: string | string[];
  arguments: string[];
  requires: string[];
  tags: string[];
  userInvocable: boolean;
  author?: string;
  authorAgent?: string;
}

export interface SkillsData {
  version: string;
  generated: string;
  skills: Skill[];
}

/* ─── Tag styling ─── */

const TAG_STYLES: Record<string, string> = {
  l1: "text-[#F7931A]/70 bg-[#F7931A]/[0.06] border-[#F7931A]/10",
  l2: "text-[#7DA2FF]/70 bg-[#7DA2FF]/[0.06] border-[#7DA2FF]/10",
  defi: "text-emerald-400/70 bg-emerald-400/[0.06] border-emerald-400/10",
  write: "text-purple-400/70 bg-purple-400/[0.06] border-purple-400/10",
  "read-only": "text-sky-400/70 bg-sky-400/[0.06] border-sky-400/10",
  infrastructure: "text-white/50 bg-white/[0.04] border-white/[0.06]",
  "mainnet-only": "text-amber-400/70 bg-amber-400/[0.06] border-amber-400/10",
  "requires-funds": "text-rose-400/70 bg-rose-400/[0.06] border-rose-400/10",
  sensitive: "text-red-400/70 bg-red-400/[0.06] border-red-400/10",
};

/** Human label + dot color for each tag, used by the filter rail and card chips. */
const TAG_META: Record<string, { label: string; dot: string }> = {
  l1: { label: "Bitcoin L1", dot: "bg-[#F7931A]" },
  l2: { label: "Stacks L2", dot: "bg-[#7DA2FF]" },
  defi: { label: "DeFi", dot: "bg-emerald-400" },
  write: { label: "Write", dot: "bg-purple-400" },
  "read-only": { label: "Read-only", dot: "bg-sky-400" },
  infrastructure: { label: "Infra", dot: "bg-white/50" },
  "mainnet-only": { label: "Mainnet", dot: "bg-amber-400" },
  "requires-funds": { label: "Needs funds", dot: "bg-rose-400" },
  sensitive: { label: "Sensitive", dot: "bg-red-400" },
};

/** Curated display order for the filter rail (layers, access, domain, flags). */
const TAG_ORDER = [
  "l1",
  "l2",
  "read-only",
  "write",
  "defi",
  "infrastructure",
  "mainnet-only",
  "requires-funds",
  "sensitive",
];

function tc(tag: string) {
  return TAG_STYLES[tag] ?? "text-white/50 bg-white/[0.04] border-white/[0.06]";
}

function tagLabel(tag: string) {
  return TAG_META[tag]?.label ?? tag;
}

function tagDot(tag: string) {
  return TAG_META[tag]?.dot ?? "bg-white/40";
}

/* ─── Short descriptions (≤6 words) ─── */

const SHORT_DESC: Record<string, string> = {
  "agent-lookup": "Query AIBTC agent network registry",
  "aibtc-agents": "AIBTC agent configs and templates",
  "aibtc-news": "Decentralized editorial intelligence platform",
  "aibtc-news-classifieds": "Post classified ads on AIBTC news",
  "aibtc-news-correspondent": "Field correspondent news reports",
  "aibtc-news-deal-flow": "Deal flow signal composition",
  "aibtc-news-fact-checker": "Verify and fact-check news claims",
  "aibtc-news-protocol": "Protocol update editorial beats",
  "aibtc-news-publisher": "Publish content to AIBTC news",
  "aibtc-news-sales": "Advertising sales and sponsorships",
  "aibtc-news-editor": "Beat editor: review signals, earn sats",
  "aibtc-news-scout": "Scout and surface emerging stories",
  bitflow: "DEX swaps with aggregated liquidity",
  bns: "Bitcoin Name System lookups",
  btc: "Bitcoin L1 balances and transfers",
  "business-dev": "Revenue pipeline and deal closing",
  ceo: "Strategic direction and resource allocation",
  "child-inscription": "Create child Bitcoin inscriptions",
  "clarity-audit": "Clarity smart contract security audit",
  "clarity-check": "Pre-deployment Clarity contract validation",
  "clarity-patterns": "Clarity contract pattern library",
  "clarity-test-scaffold": "Clarity test infrastructure generation",
  contract: "Deploy and call Clarity smart contracts",
  credentials: "Encrypted secret storage and retrieval",
  dca: "Automate DCA swaps on Bitflow",
  defi: "DeFi swaps and pool queries",
  "dual-stacking": "Stack STX across two PoX pools",
  erc8004: "ERC-8004 on-chain agent identity",
  "hermetica-yield-rotator": "Cross-protocol yield rotation automator",
  "hodlmm-bin-guardian": "Monitor HODLMM LP position ranges",
  "hodlmm-pulse": "HODLMM fee velocity momentum tracker",
  "hodlmm-range-keeper": "Active HODLMM position rebalancer",
  "hodlmm-risk": "HODLMM LP volatility risk monitoring",
  "hodlmm-signal-allocator": "Signal-gated HODLMM yield allocator",
  identity: "On-chain agent identity management",
  jingswap: "STX/sBTC blind batch auction swaps",
  "jingswap-cycle-agent": "JingSwap STX/sBTC cycle monitor",
  "maximumsats-wot": "Web of Trust trust scoring",
  "hodlmm-move-liquidity": "Rebalance HODLMM LP bin positions",
  "sbtc-yield-maximizer": "Route idle sBTC to best yield",
  "defi-portfolio-scanner": "Aggregate DeFi positions cross-protocol",
  "mempool-watch": "Bitcoin mempool transaction monitoring",
  nft: "NFT holdings, metadata, and transfers",
  "nonce-manager": "cross-process Stacks nonce oracle",
  nostr: "Nostr protocol messaging and relay",
  onboarding: "New user setup and onboarding",
  openrouter: "OpenRouter AI model integration",
  ordinals: "Inscribe content on Bitcoin",
  "ordinals-p2p": "Peer-to-peer Ordinals trading",
  paperboy: "Deliver signals, recruit correspondents",
  pillar: "Smart wallet and DCA operations",
  psbt: "Bitcoin PSBT construction and signing",
  query: "Stacks network and blockchain queries",
  reputation: "On-chain feedback and reputation scores",
  sbtc: "sBTC balances, transfers, and deposits",
  "sbtc-auto-funnel": "Route sBTC excess to Zest yield",
  settings: "Configure API keys and preferences",
  signing: "Message signing and verification",
  souldinals: "Soul-bound Ordinals identity NFTs",
  stacking: "STX stacking and PoX operations",
  "stacking-lottery": "Bitcoin stacking lottery participation",
  "stacks-market": "Prediction market trading on Stacks",
  stackspot: "Stacking lottery pot participation",
  stx: "STX token balances and transfers",
  styx: "Cross-chain bridge on Stacks",
  "taproot-multisig": "Taproot M-of-N multisig coordination",
  tenero: "Stacks market analytics and token data",
  tokens: "Fungible token operations on Stacks",
  transfer: "STX, token, and NFT transfers",
  validation: "On-chain agent validation workflows",
  wallet: "Encrypted BIP39 wallet management",
  x402: "Paid APIs and inbox messaging",
  "yield-dashboard": "sBTC yield positions dashboard",
  "yield-hunter": "Autonomous sBTC yield optimization",
  "zest-yield-manager": "autonomous sBTC yield on Zest Protocol",
  lunarcrush: "LunarCrush social intelligence via x402",
  "ordinals-marketplace": "BTC ordinals trading via Magic Eden",
  wot: "Unified Web of Trust with keySource",
};

/* ─── Helpers ─── */

/** Returns a short description: curated if available, otherwise truncated from the manifest. */
function shortDesc(skill: Skill): string {
  if (SHORT_DESC[skill.name]) return SHORT_DESC[skill.name];
  const words = skill.description.split(/\s+/);
  if (words.length <= 6) return skill.description;
  return words.slice(0, 6).join(" ") + "...";
}

/** Converts a skill name to a safe HTML id / fragment slug. */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Layer badges (L1 / L2) derived from a skill's tags. */
function layers(skill: Skill): Array<{ key: string; label: string; cls: string }> {
  const out: Array<{ key: string; label: string; cls: string }> = [];
  if (skill.tags.includes("l1"))
    out.push({ key: "l1", label: "L1", cls: "text-[#F7931A] border-[#F7931A]/30 bg-[#F7931A]/[0.08]" });
  if (skill.tags.includes("l2"))
    out.push({ key: "l2", label: "L2", cls: "text-[#7DA2FF] border-[#7DA2FF]/30 bg-[#7DA2FF]/[0.08]" });
  return out;
}

/** Non-layer category tags, used for the chips shown on a card. */
function categoryTags(skill: Skill): string[] {
  return skill.tags.filter((t) => t !== "l1" && t !== "l2");
}

/* ─── Component ─── */

export default function SkillsDirectory({ initialData }: { initialData: SkillsData | null }) {
  const data = initialData;
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [drawerShown, setDrawerShown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Stable 1-based index per skill (registry numbering, independent of filters) */
  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    data?.skills.forEach((s, i) => m.set(s.name, i + 1));
    return m;
  }, [data]);

  const activeSkill = useMemo(
    () => data?.skills.find((s) => s.name === openSkill) ?? null,
    [data, openSkill]
  );

  /* ─── Drawer open / close with enter+exit transitions ─── */
  const openDrawer = useCallback((name: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenSkill(name);
    requestAnimationFrame(() => setDrawerShown(true));
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerShown(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenSkill(null), 260);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  /* Read ?skill= (or #hash) on mount to open + scroll to a deep-linked skill */
  useEffect(() => {
    const skillParam = searchParams.get("skill");
    const target =
      skillParam ??
      (typeof window !== "undefined" ? window.location.hash.slice(1) : "");
    if (target && data?.skills.some((s) => s.name === target)) {
      setOpenSkill(target);
      requestAnimationFrame(() => setDrawerShown(true));
    }
  }, [searchParams, data]);

  /* Sync URL when openSkill changes */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (openSkill) url.searchParams.set("skill", openSkill);
    else url.searchParams.delete("skill");
    window.history.replaceState(null, "", url.toString());
  }, [openSkill]);

  /* Body scroll lock + Escape to close while drawer is open */
  useEffect(() => {
    if (!openSkill) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeBtnRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [openSkill, closeDrawer]);

  /* Keyboard shortcut: / to focus search */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Tag counts + ordered tag list for the filter rail */
  const { orderedTags, tagCounts } = useMemo(() => {
    const counts: Record<string, number> = {};
    data?.skills.forEach((sk) => sk.tags.forEach((t) => (counts[t] = (counts[t] ?? 0) + 1)));
    const present = TAG_ORDER.filter((t) => counts[t]);
    // append any tags not in the curated order
    Object.keys(counts)
      .filter((t) => !TAG_ORDER.includes(t))
      .sort()
      .forEach((t) => present.push(t));
    return { orderedTags: present, tagCounts: counts };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let skills = data.skills;
    if (tagFilter) skills = skills.filter((sk) => sk.tags.includes(tagFilter));
    const q = query.toLowerCase().trim();
    if (q) {
      skills = skills.filter(
        (sk) =>
          sk.name.toLowerCase().includes(q) ||
          sk.description.toLowerCase().includes(q) ||
          sk.arguments.some((a) => a.includes(q)) ||
          sk.tags.some((t) => t.includes(q))
      );
    }
    return skills;
  }, [data, query, tagFilter]);

  const totalCmds = useMemo(
    () => data?.skills.reduce((n, s) => n + s.arguments.length, 0) ?? 0,
    [data]
  );

  /* ─── Render ─── */
  return (
    <>
      {/* ─── Hero ─── */}
      <header className="mb-7 max-md:mb-6 text-center max-md:text-left">
        <h1 className="mb-2.5 text-[clamp(28px,3.5vw,42px)] font-medium leading-[1.1] tracking-[-0.02em] text-white">
          Agent Skills
        </h1>

        <p className="mx-auto max-w-[560px] text-[clamp(15px,1.4vw,17px)] leading-[1.6] text-white/55 max-md:mx-0">
          Drop-in capabilities for wallets, DeFi, identity, signing, and messaging
          on Bitcoin, installed with a single command.
        </p>

        {/* Terminal install block — echoes the home page browser-frame motif */}
        <div className="mx-auto mt-6 max-w-[460px] overflow-hidden rounded-xl border border-white/[0.1] bg-gradient-to-b from-[rgba(22,22,22,0.85)] to-[rgba(10,10,10,0.7)] shadow-2xl shadow-black/40 backdrop-blur-xl animate-glowPulse">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3.5 py-2">
            <div className="flex gap-1.5">
              <span className="size-2 rounded-full bg-white/10" />
              <span className="size-2 rounded-full bg-white/10" />
              <span className="size-2 rounded-full bg-white/10" />
            </div>
            <span className="ml-1.5 font-mono text-[10px] tracking-wide text-white/30">
              skills — zsh
            </span>
          </div>
          <CopyButton
            text="npx skills add aibtcdev/skills"
            label={
              <span className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
                <span className="font-mono text-[14px] text-[#F7931A]/70">$</span>
                <span className="font-mono text-[14px] max-md:text-[13px] text-white/90">
                  npx skills add aibtcdev/skills
                </span>
                <svg
                  aria-hidden="true"
                  className="ml-auto size-3.5 shrink-0 text-white/30 transition-colors group-hover:text-white/60"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </span>
            }
            variant="inline"
            className="block w-full !rounded-none"
          />
        </div>

        {/* Meta stats */}
        {data && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-white/45 max-md:justify-start">
            <Stat value={data.skills.length} label="skills" />
            <Dot />
            <Stat value={totalCmds} label="commands" />
            <Dot />
            <Stat value={orderedTags.length} label="categories" />
            <Dot />
            <a
              href="https://github.com/aibtcdev/skills"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[#F7931A]/60 transition-colors hover:text-[#F7931A]"
            >
              <svg aria-hidden="true" className="size-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Contribute a skill
            </a>
          </div>
        )}
      </header>

      {/* ─── Sticky controls (search + category rail) ─── */}
      {data && (
        <div className="sticky top-[68px] z-30 -mx-4 mb-6 rounded-2xl border border-white/[0.07] bg-[rgba(8,8,8,0.72)] px-4 py-3 backdrop-blur-xl backdrop-saturate-150 max-md:top-[60px]">
          {/* Search */}
          <div className="relative">
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 100+ skills, commands, and tags…"
              className="w-full rounded-lg border border-white/[0.07] bg-white/[0.03] py-2.5 pl-10 pr-12 text-[14px] text-white outline-none transition-colors placeholder:text-white/35 focus:border-[#F7931A]/30 focus:bg-white/[0.05]"
            />
            {query ? (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white/70"
              >
                <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : (
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-white/35 max-md:hidden">
                /
              </kbd>
            )}
          </div>

          {/* Category rail */}
          {orderedTags.length > 0 && (
            <div className="scrollbar-hide mt-3 flex items-center gap-1.5 overflow-x-auto">
              <button
                aria-pressed={tagFilter === null}
                onClick={() => setTagFilter(null)}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                  tagFilter === null
                    ? "bg-white text-black"
                    : "bg-white/[0.05] text-white/55 hover:bg-white/[0.09] hover:text-white/80"
                }`}
              >
                All
                <span className="ml-1.5 tabular-nums opacity-60">{data.skills.length}</span>
              </button>
              {orderedTags.map((tag) => {
                const active = tagFilter === tag;
                return (
                  <button
                    key={tag}
                    aria-pressed={active}
                    onClick={() => setTagFilter(active ? null : tag)}
                    className={`group flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-all ${
                      active ? tc(tag) + " opacity-100" : tc(tag) + " opacity-55 hover:opacity-90"
                    }`}
                  >
                    <span className={`size-1.5 rounded-full ${tagDot(tag)}`} />
                    {tagLabel(tag)}
                    <span className="tabular-nums opacity-60">{tagCounts[tag]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Error (server fetch failed) ─── */}
      {!data && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-20 text-center backdrop-blur-md">
          <p className="mb-3 text-[14px] text-red-400/80">Failed to load skills</p>
          <button
            onClick={() => window.location.reload()}
            className="text-[13px] text-[#F7931A]/70 transition-colors hover:text-[#F7931A]"
          >
            Try again
          </button>
        </div>
      )}

      {/* ─── Empty search ─── */}
      {data && filtered.length === 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-20 text-center backdrop-blur-md">
          <p className="mb-3 text-[14px] text-white/50">No skills match your filters</p>
          <button
            onClick={() => {
              setQuery("");
              setTagFilter(null);
            }}
            className="text-[13px] text-[#F7931A]/70 transition-colors hover:text-[#F7931A]"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ─── Card grid ─── */}
      {data && filtered.length > 0 && (
        <>
          <p className="mb-4 px-1 text-[12px] text-white/35">
            {tagFilter || query ? (
              <>
                <span className="text-white/60 tabular-nums">{filtered.length}</span> of{" "}
                {data.skills.length} skills
              </>
            ) : (
              <>
                Showing all{" "}
                <span className="text-white/60 tabular-nums">{data.skills.length}</span> skills
              </>
            )}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((skill) => {
              const cats = categoryTags(skill);
              const lyr = layers(skill);
              const slug = toSlug(skill.name);
              return (
                <button
                  key={skill.name}
                  id={slug}
                  onClick={() => openDrawer(skill.name)}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-white/[0.01] p-4 text-left backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-[#F7931A]/25 hover:from-[#F7931A]/[0.05] hover:shadow-lg hover:shadow-[#F7931A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/40"
                >
                  {/* top accent line on hover */}
                  <span className="absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-[#F7931A]/60 to-transparent transition-transform duration-300 group-hover:scale-x-100" />

                  {/* Header row: index + layer badges */}
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="font-mono text-[11px] tabular-nums text-white/20">
                      {String(indexOf.get(skill.name) ?? 0).padStart(3, "0")}
                    </span>
                    <div className="flex items-center gap-1">
                      {lyr.map((l) => (
                        <span
                          key={l.key}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none ${l.cls}`}
                        >
                          {l.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Name */}
                  <h3 className="mb-1.5 font-mono text-[15px] font-medium text-white/90 transition-colors group-hover:text-[#F7931A]">
                    {skill.name}
                  </h3>

                  {/* Short description */}
                  <p className="mb-3.5 line-clamp-2 text-[13px] leading-[1.5] text-white/50">
                    {shortDesc(skill)}
                  </p>

                  {/* Footer: tags + open affordance */}
                  <div className="mt-auto flex items-center gap-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {cats.slice(0, 2).map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/45"
                        >
                          <span className={`size-1 rounded-full ${tagDot(t)}`} />
                          {tagLabel(t)}
                        </span>
                      ))}
                      {cats.length > 2 && (
                        <span className="text-[10px] text-white/30">+{cats.length - 2}</span>
                      )}
                    </div>
                    <svg
                      aria-hidden="true"
                      className="ml-auto size-4 shrink-0 -translate-x-1 text-white/20 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-[#F7931A]/70 group-hover:opacity-100"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ─── Detail drawer ─── */}
      {activeSkill && (
        <SkillDrawer
          skill={activeSkill}
          index={indexOf.get(activeSkill.name) ?? 0}
          shown={drawerShown}
          onClose={closeDrawer}
          closeBtnRef={closeBtnRef}
        />
      )}
    </>
  );
}

/* ─── Hero stat pieces ─── */

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-medium tabular-nums text-white/80">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-white/15">·</span>;
}

/* ─── Drawer ─── */

function SkillDrawer({
  skill,
  index,
  shown,
  onClose,
  closeBtnRef,
}: {
  skill: Skill;
  index: number;
  shown: boolean;
  onClose: () => void;
  closeBtnRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const entries = Array.isArray(skill.entry) ? skill.entry : [skill.entry];
  const lyr = layers(skill);
  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : "https://aibtc.com"}/skills?skill=${encodeURIComponent(skill.name)}`;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`${skill.name} skill details`}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel — right slide-over on desktop, bottom sheet on mobile */}
      <div
        className={`absolute flex flex-col border-white/[0.1] bg-gradient-to-b from-[rgba(20,20,20,0.96)] to-[rgba(8,8,8,0.96)] backdrop-blur-2xl transition-transform duration-[280ms] ease-out
          md:inset-y-0 md:right-0 md:w-[440px] md:border-l
          max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[86vh] max-md:rounded-t-2xl max-md:border-t
          ${shown ? "translate-x-0 translate-y-0" : "max-md:translate-y-full md:translate-x-full"}`}
        style={{ willChange: "transform" }}
      >
        {/* mobile grab handle */}
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 md:hidden" />

        {/* Header */}
        <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4 max-md:pt-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-[11px] tabular-nums text-white/25">
                {String(index).padStart(3, "0")}
              </span>
              {lyr.map((l) => (
                <span
                  key={l.key}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none ${l.cls}`}
                >
                  {l.label}
                </span>
              ))}
            </div>
            <h2 className="break-words font-mono text-[20px] font-medium text-white">
              {skill.name}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/40"
          >
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <p className="mb-5 text-[14px] leading-[1.65] text-white/70">{skill.description}</p>

          {/* Install command */}
          <div className="mb-5 overflow-x-auto rounded-lg border border-[#F7931A]/20 bg-[#F7931A]/[0.05] px-4 py-3">
            <CopyButton
              text={`npx skills add aibtcdev/skills/${skill.name}`}
              label={
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="font-mono text-[13px] text-[#F7931A]/70">$</span>
                  <span className="font-mono text-[13px] max-md:text-[12px] text-white/85">
                    npx skills add aibtcdev/skills/{skill.name}
                  </span>
                  <svg aria-hidden="true" className="size-3.5 shrink-0 text-white/40 transition-colors group-hover:text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </span>
              }
              variant="inline"
            />
          </div>

          {/* Tags */}
          <Section label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {skill.tags.map((t) => (
                <span
                  key={t}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${tc(t)}`}
                >
                  <span className={`size-1.5 rounded-full ${tagDot(t)}`} />
                  {tagLabel(t)}
                </span>
              ))}
            </div>
          </Section>

          {/* Commands */}
          {skill.arguments.length > 0 && (
            <Section label={`Commands (${skill.arguments.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {skill.arguments.map((a) => (
                  <code key={a} className="rounded border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 font-mono text-[12px] leading-none text-white/65">
                    {a}
                  </code>
                ))}
              </div>
            </Section>
          )}

          {/* Entry */}
          <Section label="Entry">
            <div className="flex flex-wrap gap-1.5">
              {entries.map((e) => (
                <code key={e} className="rounded border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 font-mono text-[12px] leading-none text-white/60">
                  {e}
                </code>
              ))}
            </div>
          </Section>

          {/* Requires */}
          {skill.requires.length > 0 && (
            <Section label="Requires">
              <div className="flex flex-wrap gap-1.5">
                {skill.requires.map((r) => (
                  <span key={r} className="rounded border border-[#F7931A]/20 bg-[#F7931A]/[0.07] px-2.5 py-1 text-[12px] leading-none text-[#F7931A]/70">
                    {r}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Author */}
          {(skill.author || skill.authorAgent) && (
            <Section label="Created by">
              <p className="text-[13px] text-white/65">
                {skill.author && <span>{skill.author}</span>}
                {skill.author && skill.authorAgent && <span className="text-white/30"> / </span>}
                {skill.authorAgent && <span>{skill.authorAgent}</span>}
              </p>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-3">
          <CopyButton
            text={shareUrl}
            label={
              <span className="inline-flex items-center gap-1.5 text-[12px] text-white/45 transition-colors hover:text-white/70">
                <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Copy link
              </span>
            }
            variant="inline"
          />
          <a
            href="https://github.com/aibtcdev/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] text-[#F7931A]/60 transition-colors hover:text-[#F7931A]"
          >
            <svg aria-hidden="true" className="size-3.5" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            View source
          </a>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/45">{label}</p>
      {children}
    </div>
  );
}
