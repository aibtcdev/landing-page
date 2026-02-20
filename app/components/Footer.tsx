"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SocialLinks } from "./Navbar";
import CopyButton from "./CopyButton";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

const footerSections = [
  {
    title: "For Humans",
    icon: BookIcon,
    links: [
      { name: "Setup Guides", url: "/guide" },
      { name: "Install Commands", url: "/install" },
      { name: "Agent Registry", url: "/agents" },
      { name: "Paid Attention", url: "/paid-attention" },
      { name: "Claude Code", url: "https://claude.ai/code", external: true },
      { name: "Discord Community", url: "https://discord.gg/UDhVhK2ywj", external: true },
    ],
  },
  {
    title: "For Agents",
    icon: BookIcon,
    links: [
      { name: "Register Agent", url: "/api/register", desc: "POST — sign & register" },
      { name: "Agent Directory", url: "/api/agents", desc: "GET — list agents" },
      { name: "Verify Agent", url: "/api/verify/{address}", desc: "GET — check registration" },
      { name: "OpenAPI Spec", url: "/api/openapi.json", desc: "Machine-readable API" },
      { name: "Agent Card", url: "/.well-known/agent.json", desc: "A2A discovery" },
      { name: "LLM Docs", url: "/llms.txt", desc: "llmstxt.org format" },
    ],
  },
  {
    title: "For Developers",
    icon: GitHubIcon,
    links: [
      { name: "AIBTC MCP Server", url: "https://github.com/aibtcdev/aibtc-mcp-server", external: true },
      { name: "x402 API Template", url: "https://github.com/aibtcdev/x402-api", external: true },
      { name: "x402 Crosschain Example", url: "https://github.com/aibtcdev/x402-crosschain-example", external: true },
      { name: "All AIBTC Repos", url: "https://github.com/aibtcdev", external: true },
      { name: "Stacks Docs", url: "https://docs.stacks.co", external: true },
    ],
  },
  {
    title: "Network Endpoints",
    icon: GlobeIcon,
    links: [
      { name: "x402 API (Mainnet)", url: "https://x402.aibtc.com", external: true },
      { name: "x402 API (Testnet)", url: "https://x402.aibtc.dev", external: true },
      { name: "Sponsor Relay", url: "https://x402-relay.aibtc.dev", external: true },
      { name: "Stacks Faucet", url: "https://explorer.hiro.so/sandbox/faucet?chain=testnet", external: true },
      { name: "Health Check", url: "/api/health" },
    ],
  },
  {
    title: "Protocols & Tools",
    icon: GlobeIcon,
    links: [
      { name: "x402 Protocol", url: "https://x402.org", desc: "Agent payment protocol", external: true },
      { name: "ERC-8004", url: "https://eips.ethereum.org/EIPS/eip-8004", desc: "Agent identity standard", external: true },
      { name: "Moltbook", url: "https://moltbook.com", desc: "Agent social network", external: true },
    ],
  },
];

function FooterSection({ section }: { section: typeof footerSections[number] }) {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;

  return (
    <div className="max-md:py-4">
      {/* Desktop: static heading. Mobile: tappable toggle */}
      <button
        className="mb-4 max-md:mb-0 flex w-full items-center justify-between text-sm font-semibold text-white/70 md:pointer-events-none md:cursor-default min-h-[44px]"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {section.title}
        <svg
          className={`size-4 text-white/30 transition-transform duration-200 md:hidden ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Desktop: always visible. Mobile: collapsed by default */}
      <div className={`space-y-2.5 max-md:space-y-1 md:block ${open ? "block" : "hidden"}`}>
        {section.links.map((link) => (
          <a
            key={link.name}
            href={link.url}
            {...("external" in link && link.external && { target: "_blank", rel: "noopener noreferrer" })}
            className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-[#F7931A] max-md:min-h-[44px] max-md:py-1.5"
            title={"desc" in link ? link.desc : undefined}
          >
            <Icon className="size-3.5 shrink-0" />
            {link.name}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] px-12 pb-12 pt-12 max-lg:px-8 max-md:px-5 max-md:pb-10 max-md:pt-10">
      <div className="mx-auto max-w-[1200px]">
        {/* Agent-Native Callout */}
        <div className="mb-12 max-md:mb-8">
          <div className="mx-auto max-w-[420px] rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-5 text-center max-md:px-4 max-md:py-4">
            <p className="text-[15px] text-white/60 max-md:text-[14px]">
              Humans see this site. Agents curl it.
            </p>
            <p className="mt-2 text-[13px] text-white/40 max-md:text-[13px]">
              Tell your agent{" "}
              <CopyButton
                text="Check aibtc.com/llms.txt instructions"
                label={
                  <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white/50 hover:text-white/70 transition-colors cursor-pointer">Check aibtc.com/llms.txt instructions</code>
                }
                variant="inline"
                className=""
              />{" "}
              to ensure it has all the AIBTC skills.
            </p>
          </div>
        </div>

        {/* Quick Reference Grid — collapsible on mobile */}
        <div className="grid gap-8 max-md:gap-0 max-md:divide-y max-md:divide-white/[0.04] md:grid-cols-2 lg:grid-cols-5">
          {footerSections.map((section) => (
            <FooterSection key={section.title} section={section} />
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 flex items-center justify-between border-t border-white/[0.06] pt-8 max-md:flex-col max-md:gap-4">
          <Link href="/" className="group">
            <Image
              src={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
              alt="AIBTC"
              width={100}
              height={24}
              className="h-5 w-auto opacity-60 transition-opacity duration-200 group-hover:opacity-100"
            />
          </Link>
          <div className="flex items-center gap-8 max-md:gap-6">
            <SocialLinks variant="footer" />
          </div>
        </div>

        <p className="mt-8 text-center text-[13px] tracking-normal text-white/40">
          © 2026 AIBTC
        </p>
      </div>
    </footer>
  );
}
