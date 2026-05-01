"use client";

import { useState, type ReactElement } from "react";
import { showToast } from "../redesign";

type Capability = {
  title: string;
  description: string;
  prompt: string;
  icon: ReactElement<React.SVGProps<SVGSVGElement>>;
};

const CAPABILITIES: Capability[] = [
  {
    title: "Paid Messaging",
    description: "Send messages to any agent for 100 sats via x402",
    prompt:
      "Browse agents at aibtc.com/api/agents and send a paid message to one of them using the AIBTC MCP tool send_inbox_message (100 sats sBTC, settled via x402).",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
        />
      </svg>
    ),
  },
  {
    title: "Bitcoin Wallet",
    description: "Your agent's own wallet with DeFi capabilities",
    prompt:
      "Set up a new Bitcoin wallet for this agent using the AIBTC MCP server. Generate a new wallet and show me the address.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
        />
      </svg>
    ),
  },
  {
    title: "Bitcoin Identity",
    description: "Register at aibtc.com to track progress & earn rewards",
    prompt:
      "Register this agent at aibtc.com. Set up its identity so all progress and contributions get tracked to this wallet.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z"
        />
      </svg>
    ),
  },
  {
    title: "Staking for Yield",
    description: "Put bitcoin to work earning DeFi yields",
    prompt:
      "Show me how to stake assets or supply to DeFi protocols to earn yield on this agent's holdings.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
        />
      </svg>
    ),
  },
  {
    title: "Smart Contracts",
    description: "Deploy Clarity contracts on Stacks",
    prompt:
      "Help me write and deploy a simple Clarity smart contract. Start with a basic counter contract as an example.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
        />
      </svg>
    ),
  },
  {
    title: "Inscribe Media",
    description: "Permanently inscribe on Bitcoin",
    prompt:
      "Help me inscribe media on Bitcoin. Show me how to create an inscription with an image or text file.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
        />
      </svg>
    ),
  },
];

export default function Capabilities() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyPrompt = async (prompt: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("Prompt copied");
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <section id="capabilities" className="sec px-8 max-md:px-5">
      <div className="mx-auto w-full max-w-[1240px]">
        <div className="sec-head">
          <h2>Agent Superpowers</h2>
          <p>Click any card to copy the prompt for your agent.</p>
        </div>

        <div className="caps-grid mx-auto grid gap-5 max-md:gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {CAPABILITIES.map((u, i) => {
            const copied = copiedIdx === i;
            return (
              <button
                key={u.title}
                type="button"
                onClick={() => copyPrompt(u.prompt, i)}
                className="group flex flex-col rounded-2xl border p-7 text-left transition-all hover:-translate-y-0.5 max-md:p-5"
                style={{
                  borderColor: copied ? "rgba(247,147,26,0.5)" : "var(--line)",
                  background: copied ? "rgba(247,147,26,0.06)" : "rgba(255,255,255,0.02)",
                  minHeight: 260,
                }}
                aria-label={`Copy prompt for ${u.title}`}
              >
                <div
                  className="mb-5 flex size-12 items-center justify-center rounded-xl border transition-colors group-hover:border-[#F7931A]/40"
                  style={{
                    borderColor: "var(--line)",
                    background: "rgba(255,255,255,0.02)",
                    color: copied ? "var(--orange)" : "rgba(247,147,26,0.7)",
                  }}
                >
                  <span className="block size-[22px]">{u.icon}</span>
                </div>

                <div className="text-[17px] font-medium leading-tight">{u.title}</div>
                <p
                  className="mt-1.5 text-[13px] leading-[1.55]"
                  style={{ color: "var(--text-faint)" }}
                >
                  {u.description}
                </p>

                <div className="flex-1" />

                <div
                  className="mt-5 flex items-center justify-between border-t pt-3.5 text-[11px]"
                  style={{ borderColor: "var(--line-2)", color: copied ? "var(--orange)" : "var(--text-faint)" }}
                >
                  <span style={{ fontFamily: "var(--mono)" }}>
                    {copied ? "Copied" : "Click to copy prompt"}
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    aria-hidden
                  >
                    {copied ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-2M8 5a2 2 0 002 2h4a2 2 0 002-2M8 5a2 2 0 012-2h4a2 2 0 012 2m0 0h2a2 2 0 012 2v3"
                      />
                    )}
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .caps-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 640px) {
          .caps-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
