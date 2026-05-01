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

function tc(tag: string) {
  return TAG_STYLES[tag] ?? "text-white/50 bg-white/[0.04] border-white/[0.06]";
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

/* ─── Component ─── */

export default function SkillsDirectory({ initialData }: { initialData: SkillsData | null }) {
  const data = initialData;
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const skillRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /* Read ?skill= param on mount to open + scroll to a deep-linked skill */
  useEffect(() => {
    const skillParam = searchParams.get("skill");
    if (skillParam && data?.skills.some((s) => s.name === skillParam)) {
      setOpenSkill(skillParam);
      // Scroll after render
      requestAnimationFrame(() => {
        skillRefs.current[skillParam]?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    // Also support hash-based deep links (#wallet)
    if (!skillParam && window.location.hash) {
      const hash = window.location.hash.slice(1);
      if (data?.skills.some((s) => s.name === hash)) {
        setOpenSkill(hash);
        requestAnimationFrame(() => {
          skillRefs.current[hash]?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }
  }, [searchParams, data]);

  const toggleSkill = useCallback((name: string) => {
    setOpenSkill((prev) => (prev === name ? null : name));
  }, []);

  /* Sync URL when openSkill changes — side effects must stay outside state updater */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (openSkill) {
      url.searchParams.set("skill", openSkill);
    } else {
      url.searchParams.delete("skill");
    }
    window.history.replaceState(null, "", url.toString());
  }, [openSkill]);

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

  /* All unique tags sorted alphabetically */
  const allTags = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    data.skills.forEach((sk) => sk.tags.forEach((t) => s.add(t)));
    return [...s].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let skills = data.skills;

    // Tag filter
    if (tagFilter) {
      skills = skills.filter((sk) => sk.tags.includes(tagFilter));
    }

    // Text search
    const q = query.toLowerCase().trim();
    if (q) {
      skills = skills.filter((sk) => {
        return (
          sk.name.toLowerCase().includes(q) ||
          sk.description.toLowerCase().includes(q) ||
          sk.arguments.some((a) => a.includes(q)) ||
          sk.tags.some((t) => t.includes(q))
        );
      });
    }

    return skills;
  }, [data, query, tagFilter]);

  const totalCmds = useMemo(
    () => data?.skills.reduce((n, s) => n + s.arguments.length, 0) ?? 0,
    [data]
  );

  const tagCount = allTags.length;

  /* ─── Render ─── */
  return (
    <>
      {/* Page head — matches /agents and /activity */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <span className="eyebrow">Agent skills</span>
          <h1
            className="font-wide mt-2.5 mb-2"
            style={{
              fontSize: "clamp(28px,3.5vw,40px)",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              fontWeight: 500,
            }}
          >
            Skill library
          </h1>
          <p
            className="max-w-[640px] text-[15px]"
            style={{ color: "var(--text-dim)" }}
          >
            Plug-and-play capabilities — wallets, DeFi, identity, signing, and
            messaging — installable with a single command.
          </p>
        </div>
        <CopyButton
          text="npx skills add aibtcdev/skills"
          label={
            <span className="inline-flex items-center gap-2">
              <span style={{ color: "rgba(247,147,26,0.45)" }}>$</span>
              <span style={{ fontFamily: "var(--mono)" }}>npx skills add aibtcdev/skills</span>
            </span>
          }
          variant="inline"
          className="code-pill text-[14px]"
        />
      </div>

      {/* Stats strip */}
      {data && (
        <div
          className="mb-5 grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
        >
          {[
            { value: data.skills.length.toLocaleString(), label: "Skills", color: "var(--orange)" },
            { value: totalCmds.toLocaleString(), label: "Commands" },
            { value: tagCount.toLocaleString(), label: "Categories" },
            { value: data.version ? `v${data.version}` : "—", label: "Manifest" },
          ].map((s) => (
            <div key={s.label} className="card-rd" style={{ padding: 14 }}>
              <div
                className="text-[11px] uppercase"
                style={{ color: "var(--text-faint)", letterSpacing: "0.1em" }}
              >
                {s.label}
              </div>
              <div
                className="font-wide mt-1"
                style={{
                  fontSize: 22,
                  fontWeight: 500,
                  color: s.color ?? "var(--text)",
                  letterSpacing: "-0.02em",
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div
        className="mb-5 flex flex-wrap gap-2.5 rounded-2xl border p-3"
        style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.02)" }}
      >
        <label
          className="flex min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border px-3"
          style={{ background: "rgba(0,0,0,0.3)", borderColor: "var(--line-2)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-faint)" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills…"
            className="flex-1 rounded-sm bg-transparent py-2.5 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            style={{ color: "var(--text)" }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-white/40 transition-colors hover:text-white/60"
            >
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd
              className="rounded border px-1.5 py-0.5 text-[10px] max-md:hidden"
              style={{
                background: "rgba(255,255,255,0.04)",
                borderColor: "var(--line-2)",
                color: "var(--text-faint)",
                fontFamily: "var(--mono)",
              }}
            >
              /
            </kbd>
          )}
        </label>
      </div>

      {/* Tag chips row */}
      {data && allTags.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={tagFilter === null}
            onClick={() => setTagFilter(null)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              tagFilter === null
                ? "bg-white/[0.12] text-white"
                : "bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/80"
            }`}
            style={{ borderColor: tagFilter === null ? "rgba(255,255,255,0.15)" : "var(--line)" }}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tagFilter === tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${tc(tag)} ${tagFilter === tag ? "opacity-100" : "opacity-60 hover:opacity-90"}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Result count strip */}
      {data && (
        <div
          className="mb-3 flex items-center justify-between text-[12px]"
          style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
        >
          <span>
            {filtered.length === data.skills.length
              ? `${filtered.length.toLocaleString()} skills`
              : `${filtered.length.toLocaleString()} of ${data.skills.length.toLocaleString()}`}
          </span>
          <a
            href="https://github.com/aibtcdev/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-white/60"
            style={{ color: "rgba(247,147,26,0.7)" }}
          >
            <svg className="size-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Contribute a skill
          </a>
        </div>
      )}

      {/* Container for content states */}
      <div>
        {/* Stats strip — empty since moved above */}
        {false && data && (
          <div className="hidden">{/* placeholder — stats moved up */}</div>
        )}

        {/* ─── Content ─── */}

        {/* Error (server fetch failed) */}
        {!data && (
          <div className="rounded-2xl border border-dashed py-16 text-center"
            style={{ borderColor: "var(--line)" }}
          >
            <p className="mb-3 text-[14px] text-red-400/80">Failed to load skills</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-[13px] transition-colors hover:text-[#F7931A]"
              style={{ color: "rgba(247,147,26,0.7)" }}
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty search */}
        {data && filtered.length === 0 && (
          <div
            className="rounded-2xl border border-dashed py-16 text-center"
            style={{ borderColor: "var(--line)" }}
          >
            <p className="mb-3 text-[14px]" style={{ color: "var(--text-dim)" }}>
              No matching skills
            </p>
            <button
              type="button"
              onClick={() => { setQuery(""); setTagFilter(null); }}
              className="text-[13px] transition-colors hover:text-[#F7931A]"
              style={{ color: "rgba(247,147,26,0.7)" }}
            >
              Clear filters
            </button>
          </div>
        )}

        {/* ─── Card grid ─── */}
        {data && filtered.length > 0 && (
          <div
            className="grid gap-3.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
          >
            {filtered.map((skill) => {
              const open = openSkill === skill.name;
              const entries = Array.isArray(skill.entry) ? skill.entry : [skill.entry];
              const slug = toSlug(skill.name);

              return (
                <div
                  key={skill.name}
                  ref={(el) => { skillRefs.current[skill.name] = el; }}
                  id={slug}
                  className="card-rd cursor-pointer transition-colors"
                  style={{
                    gridColumn: open ? "1 / -1" : undefined,
                    borderColor: open ? "rgba(247,147,26,0.35)" : "var(--line)",
                    background: open ? "rgba(247,147,26,0.04)" : "rgba(255,255,255,0.02)",
                  }}
                  onClick={() => toggleSkill(skill.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSkill(skill.name);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div
                        className="mb-1 truncate text-[14px]"
                        style={{
                          fontFamily: "var(--mono)",
                          color: open ? "var(--orange)" : "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        /{skill.name}
                      </div>
                      <p
                        className="text-[12.5px]"
                        style={{ color: "var(--text-dim)", lineHeight: 1.5 }}
                      >
                        {shortDesc(skill)}
                      </p>
                    </div>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      style={{
                        color: "var(--text-faint)",
                        transform: open ? "rotate(180deg)" : "rotate(0)",
                        transition: "transform 200ms",
                        flexShrink: 0,
                      }}
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Tag chips (always visible) */}
                  {skill.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {skill.tags.map((t) => (
                        <span
                          key={t}
                          className={`inline-block rounded border px-1.5 py-0.5 text-[10px] leading-none ${tc(t)}`}
                          style={{ fontFamily: "var(--mono)" }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expanded detail */}
                  {open && (
                    <div
                      className="mt-4 space-y-3 pt-4"
                      style={{ borderTop: "1px solid var(--line-2)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Full description */}
                      <p
                        className="text-[13.5px]"
                        style={{ color: "var(--text-dim)", lineHeight: 1.6 }}
                      >
                        {skill.description}
                      </p>

                      {/* Install command pill */}
                      <div onClick={(e) => e.stopPropagation()}>
                        <CopyButton
                          text={`npx skills add aibtcdev/skills/${skill.name}`}
                          label={
                            <span className="inline-flex items-center gap-2 whitespace-nowrap">
                              <span style={{ color: "rgba(247,147,26,0.45)" }}>$</span>
                              <span style={{ fontFamily: "var(--mono)" }}>
                                npx skills add aibtcdev/skills/{skill.name}
                              </span>
                            </span>
                          }
                          variant="inline"
                          className="code-pill text-[12.5px]"
                        />
                      </div>

                      {/* Entry + Requires */}
                      <div className="flex flex-wrap gap-x-6 gap-y-3">
                        <div>
                          <p
                            className="mb-1.5 text-[10px] uppercase"
                            style={{ color: "var(--text-faint)", letterSpacing: "0.1em", fontFamily: "var(--mono)" }}
                          >
                            Entry
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {entries.map((e) => (
                              <code
                                key={e}
                                className="rounded border px-2 py-0.5 text-[11.5px] leading-none"
                                style={{
                                  borderColor: "var(--line)",
                                  background: "rgba(255,255,255,0.04)",
                                  color: "var(--text-dim)",
                                  fontFamily: "var(--mono)",
                                }}
                              >
                                {e}
                              </code>
                            ))}
                          </div>
                        </div>
                        {skill.requires.length > 0 && (
                          <div>
                            <p
                              className="mb-1.5 text-[10px] uppercase"
                              style={{ color: "var(--text-faint)", letterSpacing: "0.1em", fontFamily: "var(--mono)" }}
                            >
                              Requires
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {skill.requires.map((r) => (
                                <span
                                  key={r}
                                  className="rounded border px-2 py-0.5 text-[11.5px] leading-none"
                                  style={{
                                    borderColor: "rgba(247,147,26,0.2)",
                                    background: "rgba(247,147,26,0.06)",
                                    color: "rgba(247,147,26,0.8)",
                                  }}
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Commands */}
                      {skill.arguments.length > 0 && (
                        <div>
                          <p
                            className="mb-1.5 text-[10px] uppercase"
                            style={{ color: "var(--text-faint)", letterSpacing: "0.1em", fontFamily: "var(--mono)" }}
                          >
                            Commands
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {skill.arguments.map((a) => (
                              <code
                                key={a}
                                className="rounded border px-2 py-0.5 text-[11.5px] leading-none"
                                style={{
                                  borderColor: "var(--line)",
                                  background: "rgba(255,255,255,0.04)",
                                  color: "var(--text-dim)",
                                  fontFamily: "var(--mono)",
                                }}
                              >
                                {a}
                              </code>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Author + share link */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {(skill.author || skill.authorAgent) ? (
                          <p
                            className="text-[12px]"
                            style={{ color: "var(--text-faint)" }}
                          >
                            <span style={{ fontFamily: "var(--mono)" }}>by </span>
                            {skill.author && <span>{skill.author}</span>}
                            {skill.author && skill.authorAgent && (
                              <span style={{ color: "var(--line)" }}> / </span>
                            )}
                            {skill.authorAgent && <span>{skill.authorAgent}</span>}
                          </p>
                        ) : (
                          <span />
                        )}
                        <CopyButton
                          text={`${typeof window !== "undefined" ? window.location.origin : "https://aibtc.com"}/skills?skill=${encodeURIComponent(skill.name)}`}
                          label={
                            <span
                              className="inline-flex items-center gap-1 text-[11px] transition-colors hover:text-white/60"
                              style={{ color: "var(--text-faint)" }}
                            >
                              <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                              Share link
                            </span>
                          }
                          variant="inline"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
