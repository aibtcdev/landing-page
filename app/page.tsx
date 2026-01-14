"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const socialLinks = [
  {
    name: "X",
    href: "https://x.com/aibtcdev",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: "GitHub",
    href: "https://github.com/aibtcdev",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
      </svg>
    ),
  },
  {
    name: "Discord",
    href: "https://discord.gg/SehpxQJ2",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]">
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9460 2.4189-2.1568 2.4189Z" />
      </svg>
    ),
  },
];

function SocialLinks({
  variant = "header",
  onLinkClick,
}: {
  variant?: "header" | "footer";
  onLinkClick?: () => void;
}) {
  const baseStyles =
    variant === "header"
      ? "text-white/85 hover:text-white max-md:w-[280px] max-md:rounded-xl max-md:border max-md:border-white/10 max-md:bg-white/5 max-md:px-6 max-md:py-4 max-md:hover:border-white/20 max-md:hover:bg-white/10"
      : "text-white/60 hover:text-white";

  return (
    <>
      {socialLinks.map((link) => (
        <a
          key={link.name}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onLinkClick}
          className={`flex items-center justify-center transition-all duration-300 ${baseStyles}`}
          aria-label={link.name}
        >
          {link.icon}
        </a>
      ))}
    </>
  );
}

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
      {/* Animated Background */}
      <div
        className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
        aria-hidden="true"
      >
        {/* Background Pattern - optimized for fast loading */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
          style={{ backgroundImage: "url('/Artwork/AIBTC_Pattern1_optimized.jpg')" }}
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
            ? "bg-black/75 pb-3.5 pt-3.5 shadow-[0_4px_24px_rgba(0,0,0,0.15)] backdrop-blur-[32px] max-md:pb-3 max-md:pt-3"
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
            <SocialLinks variant="header" onLinkClick={() => setIsMenuOpen(false)} />
            <a
              href="https://app.aibtc.com"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium text-white/85 transition-all duration-300 hover:text-white max-md:w-[280px] max-md:rounded-xl max-md:border max-md:border-[#F7931A]/30 max-md:bg-[#F7931A]/10 max-md:px-6 max-md:py-4 max-md:text-center max-md:text-lg max-md:text-[#F7931A] max-md:hover:border-[#F7931A]/50 max-md:hover:bg-[#F7931A]/20"
            >
              Order Network
            </a>
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

            {/* Categories */}
            <div>
              <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/50 max-md:mb-5">
                Building Blocks
              </p>
              <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-3 max-lg:gap-3.5 max-md:grid-cols-1 max-md:gap-3">
                {/* x402 Card */}
                <a
                  href="https://x402.org"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:var(--color-blue)] [--card-glow:rgba(125,162,255,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(125,162,255,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-6 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-5 top-5 h-4 w-4 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(125,162,255,0.25)] bg-gradient-to-br from-[rgba(125,162,255,0.4)] to-[rgba(125,162,255,0.2)] text-xs font-bold text-[#B4CCFF] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-3 max-md:h-10 max-md:w-10 max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    402
                  </div>
                  <h3 className="relative z-[1] mb-1.5 text-[17px] font-semibold tracking-[0.02em] text-white max-md:text-lg">
                    x402
                  </h3>
                  <p className="relative z-[1] text-[13px] leading-[1.5] text-white/65">
                    Agent payments
                  </p>
                </a>

                {/* MCP Card */}
                <a
                  href="https://modelcontextprotocol.io"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:#10B981] [--card-glow:rgba(16,185,129,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(16,185,129,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-6 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-5 top-5 h-4 w-4 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(16,185,129,0.25)] bg-gradient-to-br from-[rgba(16,185,129,0.4)] to-[rgba(16,185,129,0.2)] text-lg font-bold text-[#6EE7B7] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-3 max-md:h-10 max-md:w-10 max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <h3 className="relative z-[1] mb-1.5 text-[17px] font-semibold tracking-[0.02em] text-white max-md:text-lg">
                    MCP
                  </h3>
                  <p className="relative z-[1] text-[13px] leading-[1.5] text-white/65">
                    Agent tools
                  </p>
                </a>

                {/* ERC-8004 Card */}
                <a
                  href="https://eips.ethereum.org/EIPS/eip-8004"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:#A855F7] [--card-glow:rgba(168,85,247,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(168,85,247,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-6 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-5 top-5 h-4 w-4 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(168,85,247,0.25)] bg-gradient-to-br from-[rgba(168,85,247,0.4)] to-[rgba(168,85,247,0.2)] text-sm font-bold text-[#D4ADFF] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-3 max-md:h-10 max-md:w-10 max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    ID
                  </div>
                  <h3 className="relative z-[1] mb-1.5 text-[17px] font-semibold tracking-[0.02em] text-white max-md:text-lg">
                    ERC-8004
                  </h3>
                  <p className="relative z-[1] text-[13px] leading-[1.5] text-white/65">
                    Agent identity
                  </p>
                </a>

                {/* ERC-8001 Card */}
                <a
                  href="https://eips.ethereum.org/EIPS/eip-8001"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:#EC4899] [--card-glow:rgba(236,72,153,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(236,72,153,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-6 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-5 top-5 h-4 w-4 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(236,72,153,0.25)] bg-gradient-to-br from-[rgba(236,72,153,0.4)] to-[rgba(236,72,153,0.2)] text-lg font-bold text-[#F9A8D4] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-3 max-md:h-10 max-md:w-10 max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                  </div>
                  <h3 className="relative z-[1] mb-1.5 text-[17px] font-semibold tracking-[0.02em] text-white max-md:text-lg">
                    ERC-8001
                  </h3>
                  <p className="relative z-[1] text-[13px] leading-[1.5] text-white/65">
                    Agent wallets
                  </p>
                </a>

                {/* sBTC Card */}
                <a
                  href="https://www.stacks.co/sbtc"
                  className="card-glow card-accent group relative block overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-7 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition-all duration-400 [--card-accent:var(--color-orange)] [--card-glow:rgba(247,147,26,0.1)] hover:-translate-y-3 hover:scale-[1.015] hover:border-white/20 hover:bg-gradient-to-br hover:from-[rgba(34,34,34,0.8)] hover:to-[rgba(21,21,21,0.6)] hover:shadow-[0_32px_72px_rgba(0,0,0,0.5),0_0_56px_rgba(247,147,26,0.1)] active:-translate-y-1 active:scale-[1.01] max-md:rounded-2xl max-md:p-6 max-md:hover:translate-y-0 max-md:hover:scale-100 max-md:active:scale-[0.98] max-md:active:opacity-90"
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseMove={handleCardMouseMove}
                >
                  <svg
                    className="absolute right-5 top-5 h-4 w-4 text-white/40 transition-all duration-300 group-hover:translate-x-[3px] group-hover:-translate-y-[3px] group-hover:text-white/80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                  <div className="relative z-[1] mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(247,147,26,0.25)] bg-gradient-to-br from-[rgba(247,147,26,0.4)] to-[rgba(247,147,26,0.2)] text-xl font-bold text-[#FFCA80] shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-all duration-400 group-hover:scale-[1.15] group-hover:-rotate-[5deg] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] max-md:mb-3 max-md:h-10 max-md:w-10 max-md:group-hover:scale-100 max-md:group-hover:rotate-0">
                    ₿
                  </div>
                  <h3 className="relative z-[1] mb-1.5 text-[17px] font-semibold tracking-[0.02em] text-white max-md:text-lg">
                    sBTC
                  </h3>
                  <p className="relative z-[1] text-[13px] leading-[1.5] text-white/65">
                    Bitcoin L2
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
      <footer className="px-12 pb-12 pt-12 max-lg:px-8 max-md:px-6 max-md:pb-10 max-md:pt-10">
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
            <SocialLinks variant="footer" />
            <a
              href="https://app.aibtc.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium tracking-[0.02em] text-white/60 transition-colors duration-200 hover:text-white max-md:text-[13px]"
            >
              Order Network
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
