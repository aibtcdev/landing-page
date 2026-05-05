"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const NAV_LINKS = [
  { href: "/agents", label: "Agents" },
  { href: "/activity", label: "Activity" },
  { href: "/bounty", label: "Bounties" },
  { href: "/skills", label: "Skills" },
  { href: "/guide", label: "Guide" },
] as const;

const SOCIAL_LINKS = [
  {
    name: "X",
    href: "https://x.com/aibtcdev",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-[14px]">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: "GitHub",
    href: "https://github.com/aibtcdev",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
      </svg>
    ),
  },
  {
    name: "Discord",
    href: "https://discord.gg/UDhVhK2ywj",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9460 2.4189-2.1568 2.4189Z" />
      </svg>
    ),
  },
] as const;

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname() || "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header
        className={`fixed left-0 right-0 top-0 z-[60] transition-[background-color,border-color,padding,backdrop-filter] duration-200 ease-out ${
          scrolled
            ? "border-b border-white/[0.04] bg-[rgba(8,8,8,0.8)] py-3 backdrop-blur-2xl backdrop-saturate-150"
            : "border-b border-transparent py-[18px]"
        } px-8 max-md:px-5`}
      >
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6">
          <Link href="/" className="group shrink-0" aria-label="AIBTC home">
            <Image
              src={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
              alt="AIBTC"
              width={120}
              height={32}
              priority
              className="h-7 w-auto transition-[filter] duration-200 group-hover:drop-shadow-[0_0_20px_rgba(247,147,26,0.5)]"
            />
          </Link>

          {/* Mobile toggle */}
          <button
            type="button"
            className="hidden size-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] transition-colors hover:border-white/20 hover:bg-white/[0.08] max-md:flex"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <div className="flex size-5 flex-col items-center justify-center gap-[5px]">
              <span className={`block h-[2px] w-5 rounded-full bg-white transition-[transform,opacity] duration-200 ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
              <span className={`block h-[2px] w-5 rounded-full bg-white transition-opacity duration-200 ${menuOpen ? "opacity-0" : ""}`} />
              <span className={`block h-[2px] w-5 rounded-full bg-white transition-[transform,opacity] duration-200 ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
            </div>
          </button>

          {/* Desktop nav */}
          <nav className="flex items-center gap-1 max-md:hidden" aria-label="Main navigation">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-[9px] px-3.5 py-2 text-[13px] font-medium transition-[color,background-color] duration-150 ${
                  isActive(link.href)
                    ? "bg-white/[0.06] text-white"
                    : "text-white/55 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <span className="mx-2 h-[18px] w-px bg-white/[0.08]" />
            <div className="flex items-center gap-1.5 mr-1">
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.name}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.name}
                  className="flex size-7 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white"
                >
                  {s.icon}
                </a>
              ))}
            </div>
            <Link
              href="/install"
              className="btn-rd btn-rd-ghost-orange btn-rd-sm"
            >
              <span
                className="status-dot"
                style={{ background: "var(--orange)", boxShadow: "0 0 6px var(--orange-glow)" }}
              />
              Install
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile overlay */}
      <nav
        className={`fixed inset-0 z-[55] hidden flex-col items-center justify-center gap-2 bg-black/95 px-5 backdrop-blur-2xl transition-[opacity,visibility] duration-300 max-md:flex ${
          menuOpen ? "visible opacity-100" : "invisible opacity-0 pointer-events-none"
        }`}
        aria-label="Mobile navigation"
      >
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMenuOpen(false)}
            className="w-full max-w-[280px] rounded-xl border border-white/10 bg-white/[0.03] px-6 py-4 text-center text-base font-medium text-white/85 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
          >
            {link.label}
          </Link>
        ))}

        <Link
          href="/install"
          onClick={() => setMenuOpen(false)}
          className="mt-2 inline-flex w-full max-w-[280px] items-center justify-center gap-2 rounded-xl border border-[#F7931A]/30 bg-[#F7931A]/[0.06] py-3.5 text-base font-medium text-[#F7931A] transition-colors hover:border-[#F7931A]/55 hover:bg-[#F7931A]/[0.12]"
        >
          <span className="status-dot" style={{ background: "var(--orange)", boxShadow: "0 0 6px var(--orange-glow)" }} />
          Install
        </Link>

        <div className="mt-4 flex items-center gap-4">
          {SOCIAL_LINKS.map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              aria-label={s.name}
              className="flex items-center justify-center text-white/50 hover:text-white"
            >
              {s.icon}
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}

function SocialLinks({
  variant = "header",
  onLinkClick,
}: {
  variant?: "header" | "footer";
  onLinkClick?: () => void;
}) {
  const styles =
    variant === "header"
      ? "text-white/40 hover:text-white"
      : "text-white/60 hover:text-white";
  return (
    <>
      {SOCIAL_LINKS.map((link) => (
        <a
          key={link.name}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onLinkClick}
          aria-label={link.name}
          className={`flex items-center justify-center transition-colors duration-200 ${styles}`}
        >
          {link.icon}
        </a>
      ))}
    </>
  );
}

export { SocialLinks, SOCIAL_LINKS as socialLinks };
