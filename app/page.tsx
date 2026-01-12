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
            className={`relative z-[1001] hidden h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] transition-all duration-300 hover:border-white/25 hover:bg-white/[0.12] max-md:flex`}
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <div className="flex h-5 w-5 flex-col items-center justify-center gap-[5px]">
              <span className={`block h-[2px] w-5 rounded-full bg-white transition-all duration-300 ${isMenuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
              <span className={`block h-[2px] w-5 rounded-full bg-white transition-all duration-300 ${isMenuOpen ? "opacity-0" : ""}`} />
              <span className={`block h-[2px] w-5 rounded-full bg-white transition-all duration-300 ${isMenuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
            </div>
          </button>

          {/* Navigation */}
          <nav
            className={`flex items-center gap-9 max-md:fixed max-md:inset-0 max-md:z-[1000] max-md:flex-col max-md:items-center max-md:justify-center max-md:gap-2 max-md:bg-black/98 max-md:backdrop-blur-[24px] max-md:transition-all max-md:duration-300 ${
              isMenuOpen
                ? "max-md:visible max-md:opacity-100"
                : "max-md:invisible max-md:opacity-0 max-md:pointer-events-none"
            }`}
            role="navigation"
            aria-label="Main navigation"
          >
            <a
              href="https://x.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-[280px] max-md:rounded-xl max-md:border max-md:border-white/10 max-md:bg-white/5 max-md:px-6 max-md:py-4 max-md:text-center max-md:text-lg max-md:hover:border-white/20 max-md:hover:bg-white/10"
            >
              X
            </a>
            <a
              href="https://github.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-[280px] max-md:rounded-xl max-md:border max-md:border-white/10 max-md:bg-white/5 max-md:px-6 max-md:py-4 max-md:text-center max-md:text-lg max-md:hover:border-white/20 max-md:hover:bg-white/10"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/SehpxQJ2"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-[280px] max-md:rounded-xl max-md:border max-md:border-white/10 max-md:bg-white/5 max-md:px-6 max-md:py-4 max-md:text-center max-md:text-lg max-md:hover:border-white/20 max-md:hover:bg-white/10"
            >
              Discord
            </a>
            <Link
              href="/orders"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-[280px] max-md:rounded-xl max-md:border max-md:border-[#F7931A]/30 max-md:bg-[#F7931A]/10 max-md:px-6 max-md:py-4 max-md:text-center max-md:text-lg max-md:text-[#F7931A] max-md:hover:border-[#F7931A]/50 max-md:hover:bg-[#F7931A]/20"
            >
              Order Network
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main id="main">
        {/* Hero Section */}
        <section className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-6">
          {/* Decorative elements */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.08)_0%,transparent_70%)] blur-3xl" />
          </div>

          <div className="relative z-[1] flex flex-col items-center text-center">
            {/* Main Headline */}
            <h1 className="mb-8 animate-fadeUp text-[clamp(36px,5vw,72px)] font-medium leading-[1.1] tracking-[-0.03em] text-white opacity-0 [animation-delay:0.1s]">
              Building the agent<br />
              <span className="relative inline-block">
                economy <span className="bg-gradient-to-r from-[#F7931A] via-[#FFAA40] to-[#F7931A] bg-clip-text text-transparent">on Bitcoin.</span>
                <span className="absolute -inset-x-4 -inset-y-2 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(247,147,26,0.15)_0%,transparent_70%)] blur-2xl"></span>
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mb-12 animate-fadeUp text-[clamp(16px,1.6vw,18px)] leading-[1.7] tracking-[0.01em] text-white/50 opacity-0 [animation-delay:0.2s]">
              Join the AIBTC public working group<br />
              and start contributing today.
            </p>

            {/* CTA */}
            <div className="animate-fadeUp opacity-0 [animation-delay:0.35s]">
              <a
                href="https://www.addevent.com/event/UM20108233"
                className="group relative inline-flex items-center justify-center gap-3 overflow-hidden rounded-full bg-[#F7931A] px-8 py-4 text-[15px] font-semibold tracking-[0.01em] text-white shadow-[0_0_0_1px_rgba(247,147,26,0.5),0_4px_24px_rgba(247,147,26,0.4)] transition-all duration-300 hover:shadow-[0_0_0_1px_rgba(247,147,26,0.6),0_8px_40px_rgba(247,147,26,0.5)] active:scale-[0.98]"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="relative z-10">Join Weekly Call</span>
                <svg className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                <div className="absolute inset-0 bg-gradient-to-r from-[#F7931A] via-[#FFAA40] to-[#F7931A] opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
              </a>
            </div>
          </div>

          {/* Scroll indicator */}
          <a
            href="#get-started"
            className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-fadeIn p-2 text-white/30 opacity-0 transition-colors duration-300 [animation-delay:0.6s] hover:text-white/50 max-md:bottom-8"
            aria-label="Scroll to learn more"
          >
            <svg className="h-5 w-5 animate-bounce-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
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
              <h2 className="mb-4 text-[clamp(32px,4vw,48px)] font-medium tracking-[0.01em] text-white max-md:text-[28px]">
                Get Started
              </h2>
              <p className="mx-auto max-w-[480px] text-[clamp(16px,1.5vw,18px)] leading-[1.7] tracking-[0.015em] text-white/50 max-md:text-[15px]">
                Anyone can use{" "}
                <a
                  href="https://claude.ai/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#F7931A] underline decoration-[#F7931A]/30 underline-offset-2 transition-all duration-200 hover:decoration-[#F7931A]"
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
                  <h3 className="relative z-[1] mb-2.5 text-[20px] font-semibold tracking-[0.02em] text-white max-md:text-xl max-[380px]:text-[19px]">
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
                  <h3 className="relative z-[1] mb-2.5 text-[20px] font-semibold tracking-[0.02em] text-white max-md:text-xl max-[380px]:text-[19px]">
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
                  <h3 className="relative z-[1] mb-2.5 text-[20px] font-semibold tracking-[0.02em] text-white max-md:text-xl max-[380px]:text-[19px]">
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
                  className="inline-flex min-w-[220px] items-center justify-center gap-2.5 rounded-2xl border border-white/15 bg-white/[0.06] px-10 py-4 text-[16px] font-semibold tracking-[0.01em] text-white backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.1] active:scale-[0.98] max-md:w-full max-md:max-w-[280px] focus-ring"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View GitHub Repos
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative px-12 pb-12 pt-12 max-lg:px-8 max-md:px-6 max-md:pb-10 max-md:pt-10">
        {/* Section Divider */}
        <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="mx-auto flex max-w-[1200px] items-center justify-between max-md:flex-col max-md:gap-8">
          <Link href="/" className="group">
            <Image
              src="/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg"
              alt="AIBTC"
              width={100}
              height={24}
              className="h-6 w-auto opacity-80 transition-all duration-300 group-hover:opacity-100 max-md:h-5"
            />
          </Link>
          <div className="flex items-center gap-8 max-md:gap-6">
            <a
              href="https://x.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium tracking-[0.02em] text-white/60 transition-colors duration-200 hover:text-white max-md:text-[13px]"
            >
              X
            </a>
            <a
              href="https://github.com/aibtcdev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium tracking-[0.02em] text-white/60 transition-colors duration-200 hover:text-white max-md:text-[13px]"
            >
              GitHub
            </a>
            <a
              href="https://discord.gg/SehpxQJ2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium tracking-[0.02em] text-white/60 transition-colors duration-200 hover:text-white max-md:text-[13px]"
            >
              Discord
            </a>
          </div>
        </div>
        <p className="mt-10 text-center text-[13px] tracking-[0.02em] text-white/40 max-md:mt-8">
          © 2026 AIBTC
        </p>
      </footer>
    </>
  );
}
