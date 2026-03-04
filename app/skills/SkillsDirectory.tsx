"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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

/* ─── Component ─── */

export default function SkillsDirectory({ initialData }: { initialData: SkillsData | null }) {
  const data = initialData;
  const [query, setQuery] = useState("");
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase().trim();
    if (!q) return data.skills;
    return data.skills.filter((sk) => {
      return (
        sk.name.toLowerCase().includes(q) ||
        sk.description.toLowerCase().includes(q) ||
        sk.arguments.some((a) => a.includes(q)) ||
        sk.tags.some((t) => t.includes(q))
      );
    });
  }, [data, query]);

  const totalCmds = useMemo(
    () => data?.skills.reduce((n, s) => n + s.arguments.length, 0) ?? 0,
    [data]
  );

  const tagCount = useMemo(() => {
    if (!data) return 0;
    const s = new Set<string>();
    data.skills.forEach((sk) => sk.tags.forEach((t) => s.add(t)));
    return s.size;
  }, [data]);

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
              <svg className="size-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd className="absolute right-5 top-1/2 -translate-y-1/2 rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-white/35 font-mono max-md:hidden">
              /
            </kbd>
          )}
        </div>

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
              onClick={() => setQuery("")}
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

                return (
                  <div key={skill.name}>
                    {/* Row */}
                    <button
                      onClick={() => setOpenSkill(open ? null : skill.name)}
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
                        {/* Description */}
                        <p className="text-[14px] leading-[1.65] text-white/70 mb-4">
                          {skill.description}
                        </p>

                        {/* Install command */}
                        <div className="mb-4 rounded-lg border border-[#F7931A]/20 bg-[#F7931A]/[0.05] px-4 py-2.5 overflow-x-auto">
                          <CopyButton
                            text={`npx skills add aibtcdev/skills/${skill.name}`}
                            label={
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                <span className="text-[#F7931A]/70 font-mono text-[13px] max-md:text-[12px]">$</span>
                                <span className="font-mono text-[13px] max-md:text-[12px] text-white/80">npx skills add aibtcdev/skills/{skill.name}</span>
                                <svg className="size-3 shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
