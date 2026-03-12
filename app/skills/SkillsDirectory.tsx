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
  "aibtc-news-deal-flow": "Deal flow signal composition",
  "aibtc-news-protocol": "Protocol update editorial beats",
  bitflow: "DEX swaps with aggregated liquidity",
  bns: "Bitcoin Name System lookups",
  btc: "Bitcoin L1 balances and transfers",
  "business-dev": "Revenue pipeline and deal closing",
  ceo: "Strategic direction and resource allocation",
  credentials: "Encrypted secret storage and retrieval",
  defi: "DeFi swaps and pool queries",
  identity: "On-chain agent identity management",
  "mempool-watch": "Bitcoin mempool transaction monitoring",
  nft: "NFT holdings, metadata, and transfers",
  ordinals: "Inscribe content on Bitcoin",
  pillar: "Smart wallet and DCA operations",
  query: "Stacks network and blockchain queries",
  reputation: "On-chain feedback and reputation scores",
  sbtc: "sBTC balances, transfers, and deposits",
  settings: "Configure API keys and preferences",
  signing: "Message signing and verification",
  stacking: "STX stacking and PoX operations",
  "stacks-market": "Prediction market trading on Stacks",
  stackspot: "Stacking lottery pot participation",
  stx: "STX token balances and transfers",
  "taproot-multisig": "Taproot M-of-N multisig coordination",
  tokens: "Fungible token operations on Stacks",
  validation: "On-chain agent validation workflows",
  wallet: "Encrypted BIP39 wallet management",
  x402: "Paid APIs and inbox messaging",
  "yield-hunter": "Autonomous sBTC yield optimization",
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
      {/* ─── Hero header ─── */}
      <div className="mb-8 max-md:mb-6 text-center max-md:text-left">
        <h1 className="mb-3 text-[clamp(28px,3.5vw,42px)] font-medium leading-[1.1] tracking-tight text-white">
          Agent Skills
        </h1>
        <p className="mx-auto max-w-[560px] text-[18px] max-md:text-[16px] leading-[1.6] text-white/70 max-md:mx-0">
          Install reusable capabilities — wallets, DeFi, identity, signing, and
          messaging — with a single command.
        </p>
      </div>

      {/* ─── Install CTA ─── */}
      <div className="mx-auto max-w-xl mb-10 max-md:mb-7 rounded-lg border border-[#F7931A]/15 bg-gradient-to-br from-[#F7931A]/[0.05] to-[#F7931A]/[0.01] px-5 py-3 max-md:px-4 max-md:py-2.5 text-center max-md:text-left backdrop-blur-[12px] animate-glowPulse">
        <CopyButton
          text="npx skills add aibtcdev/skills"
          label={
            <span className="inline-flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-[#F7931A]/70">Install</span>
              <span className="font-mono text-[15px] max-md:text-[14px]">npx skills add aibtcdev/skills</span>
              <svg aria-hidden="true" className="size-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </span>
          }
          variant="inline"
          className="text-[15px] max-md:text-[14px] font-medium text-white transition-colors duration-200 hover:text-white/80"
        />
      </div>

      {/* ─── Directory card ─── */}
      <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px] overflow-hidden">
        {/* Stats strip */}
        {data && (
          <div className="flex items-center border-b border-white/[0.06]">
            {[
              { value: data.skills.length, label: "Skills" },
              { value: totalCmds, label: "Commands" },
              { value: tagCount, label: "Categories" },
            ].map((s, i) => (
              <div
                key={s.label}
                className={`flex-1 text-center py-3 ${
                  i > 0 ? "border-l border-white/[0.06]" : ""
                }`}
              >
                <div className="text-[18px] max-md:text-[16px] font-medium text-white tabular-nums leading-none mb-1">
                  {s.value}
                </div>
                <div className="text-[11px] uppercase tracking-widest text-white/40">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative border-b border-white/[0.06]">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills ..."
            className="w-full bg-transparent py-3 px-5 pr-14 text-[14px] text-white placeholder:text-white/35 outline-none focus:bg-white/[0.02] transition-colors"
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              className="absolute right-5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
            >
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd className="absolute right-5 top-1/2 -translate-y-1/2 rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-white/35 font-mono max-md:hidden">
              /
            </kbd>
          )}
        </div>

        {/* ─── Tag filter chips ─── */}
        {data && allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-b border-white/[0.06]">
            <button
              aria-pressed={tagFilter === null}
              onClick={() => setTagFilter(null)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                tagFilter === null
                  ? "bg-white/[0.12] text-white"
                  : "bg-white/[0.04] text-white/50 hover:bg-white/[0.07] hover:text-white/70"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                aria-pressed={tagFilter === tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  tagFilter === tag
                    ? tc(tag) + " opacity-100"
                    : tc(tag) + " opacity-60 hover:opacity-80"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* ─── Content ─── */}

        {/* Error (server fetch failed) */}
        {!data && (
          <div className="px-6 py-16 text-center">
            <p className="text-[14px] text-red-400/80 mb-3">Failed to load skills</p>
            <button
              onClick={() => window.location.reload()}
              className="text-[13px] text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty search */}
        {data && filtered.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="text-[14px] text-white/50 mb-3">No matching skills</p>
            <button
              onClick={() => { setQuery(""); setTagFilter(null); }}
              className="text-[13px] text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* ─── Rows ─── */}
        {data && filtered.length > 0 && (
          <>
            <div className="divide-y divide-white/[0.05]">
              {filtered.map((skill) => {
                const open = openSkill === skill.name;
                const entries = Array.isArray(skill.entry) ? skill.entry : [skill.entry];
                const slug = toSlug(skill.name);

                return (
                  <div key={skill.name} ref={(el) => { skillRefs.current[skill.name] = el; }} id={slug}>
                    {/* Row */}
                    <button
                      onClick={() => toggleSkill(skill.name)}
                      aria-expanded={open}
                      className={`group flex w-full items-center px-5 py-3.5 text-left transition-all duration-100 ${
                        open
                          ? "bg-white/[0.03]"
                          : "hover:bg-white/[0.02]"
                      }`}
                    >
                      {/* Name + mobile description */}
                      <div className="min-w-0">
                        <span className={`text-[14px] font-medium transition-colors ${open ? "text-[#F7931A]" : "text-white/90 group-hover:text-white"}`}>
                          {skill.name}
                        </span>
                        <p className="text-[12px] text-white/50 truncate md:hidden">
                          {shortDesc(skill)}
                        </p>
                      </div>

                      {/* Short description — right aligned, desktop */}
                      <span className="ml-auto mr-3 text-[13px] text-white/50 truncate max-w-[320px] max-md:hidden">
                        {shortDesc(skill)}
                      </span>

                      {/* Chevron */}
                      <svg
                        aria-hidden="true"
                        className={`size-3.5 shrink-0 text-white/30 transition-transform duration-200 max-md:ml-auto ${open ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>

                    {/* ─── Expanded detail ─── */}
                    {open && (
                      <div className="px-5 pb-5 pt-1 bg-white/[0.015]">
                        {/* Description + share link */}
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <p className="text-[14px] leading-[1.65] text-white/70">
                            {skill.description}
                          </p>
                          <CopyButton
                            text={`${typeof window !== "undefined" ? window.location.origin : "https://aibtc.com"}/skills?skill=${encodeURIComponent(skill.name)}`}
                            label={
                              <span className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-white/60 transition-colors whitespace-nowrap">
                                <svg aria-hidden="true" className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                Link
                              </span>
                            }
                            variant="inline"
                            className="shrink-0"
                          />
                        </div>

                        {/* Install command */}
                        <div className="mb-4 rounded-lg border border-[#F7931A]/20 bg-[#F7931A]/[0.05] px-4 py-2.5 overflow-x-auto">
                          <CopyButton
                            text={`npx skills add aibtcdev/skills/${skill.name}`}
                            label={
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                <span className="text-[#F7931A]/70 font-mono text-[13px] max-md:text-[12px]">$</span>
                                <span className="font-mono text-[13px] max-md:text-[12px] text-white/80">npx skills add aibtcdev/skills/{skill.name}</span>
                                <svg aria-hidden="true" className="size-3 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </span>
                            }
                            variant="inline"
                            className="text-[13px] max-md:text-[12px]"
                          />
                        </div>

                        {/* Mobile tags */}
                        <div className="flex flex-wrap gap-1.5 mb-4 md:hidden">
                          {skill.tags.map((t) => (
                            <span
                              key={t}
                              className={`inline-block rounded border px-2 py-0.5 text-[11px] leading-[16px] ${tc(t)}`}
                            >
                              {t}
                            </span>
                          ))}
                        </div>

                        {/* Entry + Requires */}
                        <div className="flex flex-wrap gap-x-8 gap-y-3 mb-3">
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/50">Entry</p>
                            <div className="flex flex-wrap gap-1.5">
                              {entries.map((e) => (
                                <code key={e} className="rounded border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[12px] font-mono text-white/60 leading-none">{e}</code>
                              ))}
                            </div>
                          </div>
                          {skill.requires.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/50">Requires</p>
                              <div className="flex flex-wrap gap-1.5">
                                {skill.requires.map((r) => (
                                  <span key={r} className="rounded border border-[#F7931A]/20 bg-[#F7931A]/[0.07] px-2.5 py-1 text-[12px] text-[#F7931A]/70 leading-none">{r}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Commands — separate row */}
                        <div>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/50">Commands</p>
                          <div className="flex flex-wrap gap-1.5">
                            {skill.arguments.map((a) => (
                              <code key={a} className="rounded border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[12px] font-mono text-white/60 leading-none">{a}</code>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/[0.06] text-[12px] text-white/40">
              <span>
                {filtered.length === data.skills.length
                  ? `${filtered.length} skills`
                  : `${filtered.length} of ${data.skills.length}`}
              </span>
              <div className="flex items-center gap-3">
                {data.version && (
                  <span className="text-[#F7931A]/50">v{data.version}</span>
                )}
                <span>{totalCmds} commands</span>
                <span className="text-white/20">·</span>
                <a
                  href="https://github.com/aibtcdev/skills"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#F7931A]/60 hover:text-[#F7931A] transition-colors"
                >
                  <svg aria-hidden="true" className="size-3" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  Contribute a skill
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
