"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function Home() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  }, [isMenuOpen]);

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
      {/* Skip Link */}
      <a
        href="#main"
        className="absolute -top-24 left-4 z-[2000] rounded-lg bg-[#F7931A] px-6 py-3 font-semibold text-black focus:top-4"
      >
        Skip to main content
      </a>

      {/* Animated Background */}
      <div
        className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
        aria-hidden="true"
      >
        {/* Background Pattern */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
          style={{ backgroundImage: "url('/Artwork/AIBTC_Pattern1.jpg')" }}
        />

        {/* Orbs */}
        <div className="absolute -right-[200px] -top-[250px] h-[800px] w-[800px] animate-float1 rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.4)_0%,rgba(247,147,26,0.15)_40%,transparent_70%)] opacity-70 blur-[100px]" />
        <div className="absolute -bottom-[250px] -left-[200px] h-[700px] w-[700px] animate-float2 rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.35)_0%,rgba(125,162,255,0.12)_40%,transparent_70%)] opacity-60 blur-[100px]" />
        <div className="absolute bottom-[20%] -right-[150px] h-[500px] w-[500px] animate-float1-reverse rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.25)_0%,rgba(168,85,247,0.08)_40%,transparent_70%)] opacity-50 blur-[100px] max-md:hidden" />

        {/* Vignette */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.3)_40%,transparent_70%)]" />
      </div>

      {/* Header */}
      <header
        className={`fixed left-0 right-0 top-0 z-[1000] px-12 pb-5 pt-5 transition-all duration-400 max-lg:px-8 max-md:px-5 max-md:pb-4 max-md:pt-4 ${
          isScrolled
            ? "border-b border-white/[0.06] bg-black/75 pb-3.5 pt-3.5 shadow-[0_4px_24px_rgba(0,0,0,0.15)] backdrop-blur-[32px] max-md:pb-3 max-md:pt-3"
            : ""
        }`}
      >
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">
          <Link href="/" className="group">
            <Image
              src="/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg"
              alt="AIBTC"
              width={120}
              height={32}
              priority
              className="h-8 w-auto transition-all duration-300 group-hover:drop-shadow-[0_0_20px_rgba(247,147,26,0.5)] max-md:h-7"
            />
          </Link>

          {/* Mobile Menu Button */}
          <button
            className={`hidden items-center gap-2 rounded-md border border-white/15 bg-white/[0.08] px-4.5 py-2.5 text-sm font-medium text-white transition-all duration-300 hover:border-white/25 hover:bg-white/[0.12] max-md:flex ${
              isMenuOpen ? "z-[1001]" : ""
            }`}
            aria-label="Toggle menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <span>Menu</span>
            <div className={`flex flex-col gap-1 ${isMenuOpen ? "menu-btn-active" : ""}`}>
              <span className="block h-[1.5px] w-4 rounded-sm bg-white transition-all duration-300" />
              <span className="block h-[1.5px] w-4 rounded-sm bg-white transition-all duration-300" />
              <span className="block h-[1.5px] w-4 rounded-sm bg-white transition-all duration-300" />
            </div>
          </button>

          {/* Navigation */}
          <nav
            className={`flex items-center gap-9 max-md:fixed max-md:inset-0 max-md:z-[1000] max-md:flex-col max-md:items-center max-md:justify-center max-md:gap-0 max-md:bg-black/95 max-md:backdrop-blur-[24px] max-md:transition-all max-md:duration-400 ${
              isMenuOpen
                ? "max-md:visible max-md:opacity-100"
                : "max-md:invisible max-md:opacity-0"
            }`}
            role="navigation"
            aria-label="Main navigation"
          >
            <a
              href="https://x.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-full max-md:py-5 max-md:text-center max-md:text-lg"
            >
              X
            </a>
            <a
              href="https://github.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-full max-md:py-5 max-md:text-center max-md:text-lg"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/SehpxQJ2"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-full max-md:py-5 max-md:text-center max-md:text-lg"
            >
              Discord
            </a>
            <Link
              href="/orders"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-full max-md:py-5 max-md:text-center max-md:text-lg"
            >
              Order Network
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main id="main">
        {/* Hero Section */}
        <section className="relative flex min-h-[100dvh] flex-col items-center justify-center px-12 pb-[100px] pt-[140px] text-center max-lg:px-8 max-lg:pb-[90px] max-lg:pt-[130px] max-md:justify-center max-md:px-6 max-md:pb-20 max-md:pt-[100px]">
          <div className="relative z-[1] max-w-[880px] max-md:max-w-full">
            <h1 className="mb-7 animate-fadeUp text-[clamp(38px,5.8vw,68px)] font-bold leading-[1.15] tracking-[-0.04em] text-white opacity-0 [animation-delay:0.1s] [text-wrap:balance] max-md:mb-6 max-md:text-[38px] max-md:leading-[1.12] max-[380px]:text-[32px]">
              Building the agent economy
              <br />
              <span className="bg-gradient-to-br from-[#F7931A] to-[#FFB347] bg-clip-text text-transparent">
                on Bitcoin.
              </span>
            </h1>
            <p className="mx-auto mb-[52px] max-w-[845px] animate-fadeUp text-[clamp(19px,2.3vw,24px)] font-normal leading-[1.6] text-white/75 opacity-0 [animation-delay:0.2s] [text-wrap:balance] max-md:mb-10 max-md:max-w-full max-md:text-[19px] max-[380px]:text-[18px]">
              Join the AIBTC public working group and start contributing today.
            </p>
            <div className="flex animate-fadeUp flex-wrap justify-center gap-5 opacity-0 [animation-delay:0.3s] max-md:w-full max-md:flex-col max-md:items-center max-md:gap-4">
              <a
                href="https://www.addevent.com/event/UM20108233"
                className="btn-shimmer relative inline-flex min-w-[200px] items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-gradient-to-br from-[#F7931A] to-[#E8850F] px-[52px] py-4.5 text-[15px] font-semibold tracking-[-0.01em] text-white/[0.98] shadow-[0_8px_32px_rgba(247,147,26,0.4),0_2px_8px_rgba(0,0,0,0.15)] transition-all duration-300 hover:-translate-y-1 hover:bg-gradient-to-br hover:from-[#FFA033] hover:to-[#F7931A] hover:shadow-[0_16px_48px_rgba(247,147,26,0.55),0_4px_16px_rgba(0,0,0,0.2)] active:-translate-y-0.5 active:shadow-[0_8px_24px_rgba(247,147,26,0.45),0_2px_8px_rgba(0,0,0,0.15)] max-md:min-w-[240px] max-md:max-w-[320px] max-md:px-8 focus-ring"
                target="_blank"
                rel="noopener noreferrer"
              >
                Join Weekly Calls
              </a>
            </div>
          </div>

          {/* Scroll Arrow */}
          <a
            href="#get-started"
            className="absolute bottom-8 left-1/2 flex -translate-x-1/2 animate-fadeIn flex-col items-center p-3 opacity-0 transition-all duration-300 hover:translate-y-1 max-md:bottom-6"
            aria-label="Scroll to learn more"
          >
            <svg
              className="h-[22px] w-[22px] animate-bounce-slow stroke-white/50 max-md:h-5 max-md:w-5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </a>
        </section>

        {/* Get Started Section */}
        <section
          className="relative flex min-h-screen flex-col items-center justify-center px-12 py-[120px] max-lg:px-8 max-lg:py-[90px] max-md:px-6 max-md:py-[72px]"
          id="get-started"
        >
          {/* Section Divider */}
          <div className="section-divider-glow absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />

          <div className="mx-auto w-full max-w-[1200px]">
            {/* Intro */}
            <div className="mb-[72px] text-center max-md:mb-14">
              <h2 className="mb-6 text-[clamp(36px,5vw,56px)] font-bold tracking-[-0.03em] text-white [text-wrap:balance] max-md:text-[36px] max-[380px]:text-[32px]">
                Get Started
              </h2>
              <p className="mx-auto max-w-[580px] text-[clamp(16px,2vw,18px)] leading-[1.7] text-white/75 [text-wrap:balance] max-md:text-[15px]">
                Anyone can use{" "}
                <a
                  href="https://claude.ai/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-b border-transparent font-medium text-[#F7931A] transition-all duration-200 hover:border-[#F7931A] hover:[text-shadow:0_0_20px_rgba(247,147,26,0.5)]"
                >
                  Claude Code
                </a>{" "}
                to start building with agents and contributing to AIBTC.
              </p>
            </div>

            {/* Initiatives */}
            <div>
              <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/50 max-md:mb-5">
                Current Initiatives
              </p>
              <div className="grid grid-cols-3 gap-5 max-lg:gap-3.5 max-md:grid-cols-1 max-md:gap-3">
                {/* x402 Card */}
                <a
                  href="https://stx402.com/"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-9 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:var(--color-blue)] [--card-glow:rgba(125,162,255,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(125,162,255,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-7 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-6 top-6 h-5 w-5 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-[rgba(125,162,255,0.25)] bg-gradient-to-br from-[rgba(125,162,255,0.4)] to-[rgba(125,162,255,0.2)] text-sm font-bold text-[#B4CCFF] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-4 max-md:h-12 max-md:w-12 max-md:text-xs max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    x402
                  </div>
                  <h3 className="relative z-[1] mb-2.5 text-[22px] font-bold tracking-[-0.02em] text-white max-md:text-xl max-[380px]:text-[19px]">
                    x402
                  </h3>
                  <p className="relative z-[1] text-[15px] leading-[1.6] text-white/65">
                    Agent payment protocol
                  </p>
                </a>

                {/* ERC-8004 Card */}
                <a
                  href="https://github.com/aibtcdev/erc-8004-stacks"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-9 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:#A855F7] [--card-glow:rgba(168,85,247,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(168,85,247,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-7 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-6 top-6 h-5 w-5 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-[rgba(168,85,247,0.25)] bg-gradient-to-br from-[rgba(168,85,247,0.4)] to-[rgba(168,85,247,0.2)] text-lg font-bold text-[#D4ADFF] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-4 max-md:h-12 max-md:w-12 max-md:text-base max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    ID
                  </div>
                  <h3 className="relative z-[1] mb-2.5 text-[22px] font-bold tracking-[-0.02em] text-white max-md:text-xl max-[380px]:text-[19px]">
                    ERC-8004
                  </h3>
                  <p className="relative z-[1] text-[15px] leading-[1.6] text-white/65">
                    Agent identities
                  </p>
                </a>

                {/* sBTC Card */}
                <a
                  href="https://www.stacks.co/sbtc"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-9 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:var(--color-orange)] [--card-glow:rgba(247,147,26,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(247,147,26,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-7 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-6 top-6 h-5 w-5 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-[rgba(247,147,26,0.25)] bg-gradient-to-br from-[rgba(247,147,26,0.4)] to-[rgba(247,147,26,0.2)] text-[22px] font-bold text-[#FFCA80] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-4 max-md:h-12 max-md:w-12 max-md:text-xl max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    ₿
                  </div>
                  <h3 className="relative z-[1] mb-2.5 text-[22px] font-bold tracking-[-0.02em] text-white max-md:text-xl max-[380px]:text-[19px]">
                    sBTC
                  </h3>
                  <p className="relative z-[1] text-[15px] leading-[1.6] text-white/65">
                    Programmable Bitcoin
                  </p>
                </a>
              </div>

              {/* CTA */}
              <div className="mt-12 text-center max-md:mt-8">
                <a
                  href="https://github.com/aibtcdev"
                  className="btn-shimmer relative inline-flex min-w-[200px] items-center justify-center gap-2.5 overflow-hidden rounded-xl border-[1.5px] border-white/20 bg-white/[0.05] px-[52px] py-4.5 text-[15px] font-semibold tracking-[-0.01em] text-white backdrop-blur-[12px] transition-all duration-300 hover:-translate-y-1 hover:border-white/35 hover:bg-white/[0.12] hover:shadow-[0_12px_32px_rgba(0,0,0,0.2)] active:-translate-y-0.5 active:shadow-[0_6px_16px_rgba(0,0,0,0.15)] max-md:min-w-[240px] max-md:max-w-[320px] max-md:px-8 focus-ring"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View AIBTC GitHub Repos
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative px-12 pb-11 pt-11 max-lg:px-8 max-lg:pb-10 max-lg:pt-10 max-md:px-6 max-md:pb-8 max-md:pt-8">
        {/* Section Divider */}
        <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

        <div className="mx-auto flex max-w-[1200px] items-center justify-between max-md:flex-col max-md:gap-6">
          <Link href="/" className="group">
            <Image
              src="/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg"
              alt="AIBTC"
              width={100}
              height={24}
              className="h-6 w-auto opacity-85 transition-all duration-300 group-hover:opacity-100 group-hover:drop-shadow-[0_0_16px_rgba(247,147,26,0.5)] max-md:h-[18px]"
            />
          </Link>
          <div className="flex gap-8 max-md:gap-6">
            <a
              href="https://x.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link relative py-2 text-xs font-medium uppercase tracking-[0.1em] text-white/85 transition-all duration-200 hover:text-white max-md:px-2 max-md:py-3 max-md:text-[11px]"
            >
              X
            </a>
            <a
              href="https://github.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link relative py-2 text-xs font-medium uppercase tracking-[0.1em] text-white/85 transition-all duration-200 hover:text-white max-md:px-2 max-md:py-3 max-md:text-[11px]"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/SehpxQJ2"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link relative py-2 text-xs font-medium uppercase tracking-[0.1em] text-white/85 transition-all duration-200 hover:text-white max-md:px-2 max-md:py-3 max-md:text-[11px]"
            >
              Discord
            </a>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-white/60 max-md:mt-6">
          © 2026 AIBTC
        </p>
      </footer>
    </>
  );
}
