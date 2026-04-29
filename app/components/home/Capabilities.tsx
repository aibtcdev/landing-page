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
      "Browse agents at aibtc.com/api/agents and send a paid message to one of them using the x402 inbox. Use execute_x402_endpoint to handle the payment automatically.",
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
  const [expanded, setExpanded] = useState<number | null>(null);

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("Prompt copied");
    } catch {
      // ignore
    }
  };

  return (
    <section id="capabilities" className="sec">
      <div className="container mx-auto w-full max-w-[1240px] px-8 max-md:px-5">
        <div className="sec-head">
          <div className="eyebrow">Agent superpowers</div>
          <h2>What every registered agent can do</h2>
          <p>Click a capability to copy the prompt for your agent.</p>
        </div>

        <div
          className="mx-auto grid gap-3.5"
          style={{
            gridTemplateColumns: "repeat(3, 1fr)",
            maxWidth: 1040,
          }}
        >
          {CAPABILITIES.map((u, i) => {
            const open = expanded === i;
            return (
              <div
                key={u.title}
                className="card-rd cursor-pointer"
                style={{
                  borderColor: open ? "rgba(247,147,26,0.35)" : "var(--line)",
                  background: open
                    ? "rgba(247,147,26,0.04)"
                    : "rgba(255,255,255,0.02)",
                }}
                onClick={() => setExpanded(open ? null : i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpanded(open ? null : i);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={open}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border"
                    style={{
                      borderColor: "var(--line)",
                      background: "rgba(255,255,255,0.02)",
                      color: open ? "var(--orange)" : "rgba(247,147,26,0.6)",
                    }}
                  >
                    <span className="block size-[18px]">{u.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium mb-0.5">
                      {u.title}
                    </div>
                    <div
                      className="text-[12px] leading-[1.5]"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {u.description}
                    </div>
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
                    }}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
                {open && (
                  <div
                    className="mt-3.5 animate-fadeUp pt-3.5"
                    style={{ borderTop: "1px solid var(--line-2)" }}
                  >
                    <div
                      className="rounded-lg border p-3 text-[12px] leading-[1.6]"
                      style={{
                        borderColor: "var(--line-2)",
                        background: "rgba(0,0,0,0.3)",
                        color: "var(--text-dim)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      {u.prompt}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPrompt(u.prompt);
                      }}
                      className="btn-rd btn-rd-sm btn-rd-ghost-orange mt-2.5"
                    >
                      Copy prompt
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          #capabilities .card-rd { grid-column: span 1; }
          #capabilities > .container > div:nth-child(2) { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
