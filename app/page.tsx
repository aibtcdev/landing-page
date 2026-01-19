"use client";

import Image from "next/image";
import Link from "next/link";
import Navbar, { SocialLinks } from "./components/Navbar";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function Home() {
  const handleCardMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty("--mouse-x", x + "%");
    card.style.setProperty("--mouse-y", y + "%");
  };

  return (
    <>
      {/* Animated Background */}
      <div
        className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
        aria-hidden="true"
      >
        {/* Background Pattern - optimized for fast loading */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
          style={{ backgroundImage: `url('${basePath}/Artwork/AIBTC_Pattern1_optimized.jpg')` }}
        />

        {/* Orbs */}
        <div className="absolute -right-[200px] -top-[250px] h-[800px] w-[800px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.4)_0%,rgba(247,147,26,0.15)_40%,transparent_70%)] opacity-70 blur-[100px] animate-float1" />
        <div className="absolute -bottom-[250px] -left-[200px] h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.35)_0%,rgba(125,162,255,0.12)_40%,transparent_70%)] opacity-60 blur-[100px] animate-float2" />
        <div className="absolute bottom-[20%] -right-[150px] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.2)_0%,rgba(125,162,255,0.08)_40%,transparent_70%)] opacity-40 blur-[100px] max-md:hidden animate-float1-reverse" />

        {/* Vignette */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.3)_40%,transparent_70%)]" />
      </div>

      <Navbar />

      {/* Main Content */}
      <main id="main">
        {/* Hero Section */}
        <section className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-6">
          {/* Decorative elements */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.08)_0%,transparent_70%)] blur-3xl" />
          </div>

          <div className="relative z-10 flex flex-col items-center text-center">
            {/* Main Headline */}
            <h1 className="mb-8 animate-fadeUp text-balance text-[clamp(36px,5vw,72px)] font-medium leading-[1.1] text-white opacity-0 [animation-delay:0.1s]">
              Building the agent<br />
              <span className="relative inline-block">
                economy <span className="bg-gradient-to-r from-[#F7931A] via-[#FFAA40] to-[#F7931A] bg-clip-text text-transparent">on Bitcoin.</span>
                <span className="absolute -inset-x-4 -inset-y-2 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(247,147,26,0.15)_0%,transparent_70%)] blur-2xl"></span>
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mb-12 animate-fadeUp text-[clamp(16px,1.6vw,18px)] leading-[1.7] tracking-normal text-white/50 opacity-0 [animation-delay:0.2s]">
              Join the AIBTC public working group<br />
              and start contributing today.
            </p>

            {/* CTA */}
            <div className="animate-fadeUp opacity-0 [animation-delay:0.35s]">
              <a
                href="https://www.addevent.com/event/UM20108233"
                className="inline-flex items-center justify-center rounded-xl bg-[#F7931A] px-7 py-3.5 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98]"
                target="_blank"
                rel="noopener noreferrer"
              >
                Join Weekly Call
              </a>
            </div>
          </div>

          {/* Scroll indicator */}
          <a
            href="#our-stack"
            className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-fadeIn p-3 text-white/30 opacity-0 transition-colors duration-200 [animation-delay:0.6s] hover:text-white/50 max-md:bottom-8 max-md:p-4"
            aria-label="Scroll to learn more"
          >
            <svg className="size-5 animate-bounce-slow max-md:size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </a>
        </section>

        {/* Get Started Section */}
        <section
          className="relative flex min-h-screen flex-col items-center justify-center px-12 py-[120px] max-lg:px-8 max-lg:py-[90px] max-md:px-6 max-md:py-[72px]"
          id="our-stack"
        >
          <div className="mx-auto w-full max-w-[1200px]">
            {/* Intro */}
            <div className="mb-12 text-center max-md:mb-10">
              <h2 className="mb-4 text-balance text-[clamp(32px,4vw,48px)] font-medium text-white max-md:text-[28px]">
                Our Stack
              </h2>
              <p className="mx-auto max-w-[520px] text-[clamp(16px,1.5vw,18px)] leading-[1.7] tracking-normal text-white/50 max-md:text-[15px]">
                Open-source building blocks powering the agent economy on Bitcoin.
              </p>
            </div>

            {/* Categories */}
            <div>
              <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-3 max-lg:gap-3.5 max-md:grid-cols-1 max-md:gap-3">
                {/* x402 Card */}
                <div className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-xl backdrop-blur-[12px] [--card-accent:var(--color-blue)] [--card-glow:rgba(125,162,255,0.1)] max-md:rounded-2xl max-md:p-6">
                  <div className="relative z-10 mb-4 flex size-11 items-center justify-center rounded-xl border border-[rgba(125,162,255,0.25)] bg-gradient-to-br from-[rgba(125,162,255,0.4)] to-[rgba(125,162,255,0.2)] text-xs font-bold text-[#B4CCFF] shadow-lg max-md:mb-3 max-md:h-10 max-md:w-10">
                    402
                  </div>
                  <h3 className="relative z-10 mb-1.5 text-balance text-[17px] font-semibold text-white max-md:text-lg">
                    x402
                  </h3>
                  <p className="relative z-10 mb-4 text-[13px] leading-[1.5] text-white/65">
                    Agent payments
                  </p>
                  <div className="relative z-10 flex flex-col gap-3 border-t border-white/[0.06] pt-4">
                    <a href="https://x402.org" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#B4CCFF]">x402.org →</span>
                      <span className="block text-[11px] text-white/40">Protocol specification</span>
                    </a>
                    <a href="https://www.stacksx402.com" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#B4CCFF]">stacksx402.com →</span>
                      <span className="block text-[11px] text-white/40">Endpoint directory</span>
                    </a>
                    <a href="https://x402.aibtc.dev" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#B4CCFF]">x402.aibtc.dev →</span>
                      <span className="block text-[11px] text-white/40">Testnet playground</span>
                    </a>
                  </div>
                </div>

                {/* MCP Card */}
                <div className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-xl backdrop-blur-[12px] [--card-accent:#10B981] [--card-glow:rgba(16,185,129,0.1)] max-md:rounded-2xl max-md:p-6">
                  <div className="relative z-10 mb-4 flex size-11 items-center justify-center rounded-xl border border-[rgba(16,185,129,0.25)] bg-gradient-to-br from-[rgba(16,185,129,0.4)] to-[rgba(16,185,129,0.2)] text-lg font-bold text-[#6EE7B7] shadow-lg max-md:mb-3 max-md:h-10 max-md:w-10">
                    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <h3 className="relative z-10 mb-1.5 text-balance text-[17px] font-semibold text-white max-md:text-lg">
                    MCP
                  </h3>
                  <p className="relative z-10 mb-4 text-[13px] leading-[1.5] text-white/65">
                    Agent tools
                  </p>
                  <div className="relative z-10 flex flex-col gap-3 border-t border-white/[0.06] pt-4">
                    <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#6EE7B7]">MCP spec →</span>
                      <span className="block text-[11px] text-white/40">Protocol documentation</span>
                    </a>
                    <a href="https://github.com/biwasxyz/stx402-agent" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#6EE7B7]">stx402-agent →</span>
                      <span className="block text-[11px] text-white/40">Stacks wallet MCP server</span>
                    </a>
                  </div>
                </div>

                {/* Agent Registry Card */}
                <div className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-xl backdrop-blur-[12px] [--card-accent:#A855F7] [--card-glow:rgba(168,85,247,0.1)] max-md:rounded-2xl max-md:p-6">
                  <div className="relative z-10 mb-4 flex size-11 items-center justify-center rounded-xl border border-[rgba(168,85,247,0.25)] bg-gradient-to-br from-[rgba(168,85,247,0.4)] to-[rgba(168,85,247,0.2)] text-sm font-bold text-[#D4ADFF] shadow-lg max-md:mb-3 max-md:h-10 max-md:w-10">
                    ID
                  </div>
                  <h3 className="relative z-10 mb-1.5 text-balance text-[17px] font-semibold text-white max-md:text-lg">
                    Agent Registry
                  </h3>
                  <p className="relative z-10 mb-4 text-[13px] leading-[1.5] text-white/65">
                    Agent identity
                  </p>
                  <div className="relative z-10 flex flex-col gap-3 border-t border-white/[0.06] pt-4">
                    <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#D4ADFF]">ERC-8004 →</span>
                      <span className="block text-[11px] text-white/40">Ethereum EIP spec</span>
                    </a>
                    <a href="https://github.com/aibtcdev/aibtcdev-daos" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#D4ADFF]">GitHub →</span>
                      <span className="block text-[11px] text-white/40">Stacks implementation</span>
                    </a>
                    <a href="https://github.com/stacksgov/sips" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#D4ADFF]">Stacks SIP →</span>
                      <span className="block text-[11px] text-white/40">Draft proposal</span>
                    </a>
                  </div>
                </div>

                {/* Agent Intents Card */}
                <div className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-xl backdrop-blur-[12px] [--card-accent:#EC4899] [--card-glow:rgba(236,72,153,0.1)] max-md:rounded-2xl max-md:p-6">
                  <div className="relative z-10 mb-4 flex size-11 items-center justify-center rounded-xl border border-[rgba(236,72,153,0.25)] bg-gradient-to-br from-[rgba(236,72,153,0.4)] to-[rgba(236,72,153,0.2)] text-lg font-bold text-[#F9A8D4] shadow-lg max-md:mb-3 max-md:h-10 max-md:w-10">
                    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                  </div>
                  <h3 className="relative z-10 mb-1.5 text-balance text-[17px] font-semibold text-white max-md:text-lg">
                    Agent Intents
                  </h3>
                  <p className="relative z-10 mb-4 text-[13px] leading-[1.5] text-white/65">
                    Agent wallets
                  </p>
                  <div className="relative z-10 flex flex-col gap-3 border-t border-white/[0.06] pt-4">
                    <a href="https://eips.ethereum.org/EIPS/eip-8001" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#F9A8D4]">ERC-8001 →</span>
                      <span className="block text-[11px] text-white/40">Ethereum EIP spec</span>
                    </a>
                    <a href="https://github.com/stacksgov/sips" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#F9A8D4]">Stacks SIP →</span>
                      <span className="block text-[11px] text-white/40">Kwame's draft proposal</span>
                    </a>
                  </div>
                </div>

                {/* Stacks Card */}
                <div className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-xl backdrop-blur-[12px] [--card-accent:var(--color-orange)] [--card-glow:rgba(247,147,26,0.1)] max-md:rounded-2xl max-md:p-6">
                  <div className="relative z-10 mb-4 flex size-11 items-center justify-center rounded-xl border border-[rgba(247,147,26,0.25)] bg-gradient-to-br from-[rgba(247,147,26,0.4)] to-[rgba(247,147,26,0.2)] text-[#FFCA80] shadow-lg max-md:mb-3 max-md:h-10 max-md:w-10">
                    <svg className="size-5" viewBox="0 0 21 22" fill="currentColor">
                      <path fillRule="evenodd" clipRule="evenodd" d="M13.7663 7.58669C13.6897 7.45517 13.7007 7.29078 13.7882 7.15926L17.4445 1.73424C17.543 1.58081 17.554 1.39449 17.4664 1.24106C17.3788 1.07666 17.2146 0.988987 17.0395 0.988987H15.6164C15.4631 0.988987 15.3099 1.0657 15.2113 1.20818L10.942 7.56477C10.8326 7.72916 10.6574 7.81684 10.4604 7.81684H9.92398C9.72693 7.81684 9.55178 7.7182 9.44231 7.56477L5.19491 1.19722C5.10734 1.05474 4.94314 0.978027 4.78988 0.978027H3.36678C3.19163 0.978027 3.01648 1.07666 2.93985 1.24106C2.85228 1.40545 2.87417 1.59177 2.96175 1.73424L6.61801 7.17022C6.70559 7.29078 6.71653 7.45517 6.63991 7.58669C6.56328 7.72916 6.43192 7.80588 6.27866 7.80588H0.684789C0.411116 7.80588 0.203125 8.02507 0.203125 8.2881V9.47174C0.203125 9.74574 0.422063 9.95397 0.684789 9.95397H19.7215C19.9951 9.95397 20.2031 9.73478 20.2031 9.47174V8.2881C20.2031 8.03603 20.017 7.83876 19.7762 7.80588C19.7543 7.80588 19.7324 7.80588 19.7105 7.80588H14.1276C13.9743 7.80588 13.832 7.72916 13.7663 7.58669ZM9.45326 14.568L5.18397 20.9246C5.09639 21.067 4.93219 21.1438 4.77893 21.1438H3.35583C3.18068 21.1438 3.01648 21.0451 2.9289 20.8917C2.84133 20.7382 2.85228 20.541 2.9508 20.3985L6.59612 14.9735C6.68369 14.842 6.69464 14.6885 6.61801 14.5461C6.54138 14.4145 6.41002 14.3269 6.25676 14.3269H0.684789C0.422063 14.3269 0.203125 14.1186 0.203125 13.8446V12.661C0.203125 12.398 0.411116 12.1788 0.684789 12.1788H19.6777C19.6777 12.1788 19.7105 12.1788 19.7215 12.1788C19.9842 12.1788 20.2031 12.387 20.2031 12.661V13.8446C20.2031 14.1077 19.9951 14.3269 19.7215 14.3269H14.1385C13.9743 14.3269 13.843 14.4036 13.7773 14.5461C13.7007 14.6885 13.7116 14.842 13.7992 14.9625L17.4555 20.3985C17.543 20.541 17.5649 20.7273 17.4773 20.8917C17.3898 21.0561 17.2256 21.1547 17.0504 21.1547H15.6273C15.4631 21.1547 15.3208 21.078 15.2332 20.9465L10.9639 14.5899C10.8545 14.4255 10.6793 14.3378 10.4823 14.3378H9.94587C9.74883 14.3378 9.57368 14.4365 9.46421 14.5899L9.45326 14.568Z" />
                    </svg>
                  </div>
                  <h3 className="relative z-10 mb-1.5 text-balance text-[17px] font-semibold text-white max-md:text-lg">
                    Stacks
                  </h3>
                  <p className="relative z-10 mb-4 text-[13px] leading-[1.5] text-white/65">
                    Bitcoin L2
                  </p>
                  <div className="relative z-10 flex flex-col gap-3 border-t border-white/[0.06] pt-4">
                    <a href="https://www.stacks.co" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#FFCA80]">stacks.co →</span>
                      <span className="block text-[11px] text-white/40">Stacks ecosystem</span>
                    </a>
                    <a href="https://www.stacks.co/sbtc" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#FFCA80]">sBTC →</span>
                      <span className="block text-[11px] text-white/40">Bitcoin-backed token</span>
                    </a>
                    <a href="https://docs.stacks.co" target="_blank" rel="noopener noreferrer" className="group/link block py-1 max-md:py-1.5">
                      <span className="text-[12px] text-white/70 transition-colors group-hover/link:text-[#FFCA80]">Docs →</span>
                      <span className="block text-[11px] text-white/40">Developer documentation</span>
                    </a>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <div className="mt-12 text-center max-md:mt-8">
                <a
                  href="https://github.com/aibtcdev"
                  className="inline-flex min-w-[220px] items-center justify-center gap-2.5 rounded-2xl border border-white/15 bg-white/[0.06] px-10 py-4 text-[16px] font-semibold tracking-normal text-white backdrop-blur-sm transition-[transform,background-color,border-color] duration-200 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.1] active:scale-[0.98] max-md:w-full max-md:max-w-[280px] focus-ring"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View GitHub Repos
                </a>
              </div>

              {/* Guidance prompt */}
              <div className="mt-16 flex justify-center max-md:mt-12">
                <a
                  href="#guide"
                  className="inline-flex flex-col items-center gap-2 text-white/40 transition-colors duration-200 hover:text-white/60"
                >
                  <span className="text-sm">Need guidance?</span>
                  <svg className="size-4 animate-bounce-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Guide Section */}
        <section id="guide" className="relative scroll-mt-24 px-12 pb-[220px] pt-[140px] max-lg:px-8 max-lg:pb-[180px] max-lg:pt-[120px] max-md:scroll-mt-20 max-md:px-6 max-md:pb-[140px] max-md:pt-[100px]">
          <div className="mx-auto max-w-[800px]">
            {/* Section Header */}
            <div className="mb-12 text-center max-md:mb-10">
              <h2 className="mb-4 text-balance text-[clamp(32px,4vw,48px)] font-medium text-white max-md:text-[28px]">
                Getting Started
              </h2>
              <p className="text-[clamp(16px,1.5vw,18px)] leading-[1.7] tracking-normal text-white/50 max-md:text-[15px]">
                Anyone can use agents to start building and contributing to AIBTC.
              </p>
            </div>

            <Link
              href="/guide"
              className="group relative block overflow-hidden rounded-2xl border border-white/[0.08] bg-[rgba(20,20,20,0.6)] backdrop-blur-sm transition-[background-color,border-color] duration-200 hover:border-white/[0.15] hover:bg-[rgba(28,28,28,0.7)]"
            >
              {/* Top accent line */}
              <div className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-[#F7931A]/30 to-transparent" />

              {/* Stacked pages effect */}
              <div className="absolute -bottom-1.5 left-3 right-3 h-3 rounded-b-xl border-x border-b border-white/[0.04] bg-[rgba(16,16,16,0.5)]" />
              <div className="absolute -bottom-3 left-6 right-6 h-3 rounded-b-xl border-x border-b border-white/[0.02] bg-[rgba(12,12,12,0.4)]" />

              <div className="relative flex gap-6 p-8 max-md:flex-col max-md:p-6">
                {/* Book icon */}
                <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-[rgba(247,147,26,0.25)] bg-gradient-to-br from-[rgba(247,147,26,0.15)] to-[rgba(247,147,26,0.05)] max-md:size-12">
                  <svg className="size-7 text-[#F7931A] max-md:size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                {/* Content */}
                <div className="flex-1">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="rounded bg-[#F7931A]/20 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#F7931A]">Guide</span>
                    <span className="text-[12px] text-white/40">~30 min</span>
                  </div>
                  <h3 className="mb-2 text-balance text-[20px] font-semibold text-white max-md:text-[18px]">
                    Vibe Coding with Bitcoin Agents
                  </h3>
                  <p className="mb-4 text-[14px] leading-relaxed text-white/50">
                    Build AI agents with Bitcoin wallets and payment-gated APIs.
                  </p>

                  {/* Steps preview */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-white/40">
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-[#D97757]" />
                      Claude Code
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-[#F7931A]" />
                      Agent Wallet
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-[#B4CCFF]" />
                      x402 Endpoints
                    </span>
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex items-center self-center text-white/30 transition-[transform,color] duration-200 group-hover:translate-x-1 group-hover:text-[#F7931A] max-md:self-start">
                  <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-12 pb-12 pt-12 max-lg:px-8 max-md:px-6 max-md:pb-10 max-md:pt-10">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between max-md:flex-col max-md:gap-8">
          <Link href="/" className="group">
            <Image
              src={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
              alt="AIBTC"
              width={100}
              height={24}
              className="h-6 w-auto opacity-80 transition-opacity duration-200 group-hover:opacity-100 max-md:h-5"
            />
          </Link>
          <div className="flex items-center gap-8 max-md:gap-6">
            <SocialLinks variant="footer" />
          </div>
        </div>
        <p className="mt-10 text-center text-[13px] tracking-normal text-white/40 max-md:mt-8">
          © 2026 AIBTC
        </p>
      </footer>
    </>
  );
}
