"use client";

import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------
 * Toast — tiny global toast with window.__showToast(msg) bridge
 * ------------------------------------------------------------------ */

declare global {
  interface Window {
    __showToast?: (msg: string) => void;
  }
}

export function ToastRoot() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.__showToast = (m: string) => {
      setMsg(m);
      setShow(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShow(false), 1800);
    };
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.__showToast = undefined;
    };
  }, []);

  return <div className={`toast ${show ? "show" : ""}`}>{msg}</div>;
}

export function showToast(msg: string) {
  if (typeof window !== "undefined" && window.__showToast) window.__showToast(msg);
}

/* ------------------------------------------------------------------
 * CommandPill — copyable monospace pill for shell commands
 * ------------------------------------------------------------------ */

export function CommandPill({
  text,
  size = "md",
  className = "",
  prompt = true,
  toastMessage,
}: {
  text: string;
  size?: "md" | "lg";
  className?: string;
  prompt?: boolean;
  toastMessage?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast(toastMessage || "Copied to clipboard");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — older browsers / blocked permission
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className={`code-pill cursor-pointer transition-colors hover:border-[#F7931A]/45 ${className}`}
      style={{
        fontSize: size === "lg" ? 17 : 15,
        padding: size === "lg" ? "14px 20px" : "10px 16px",
      }}
      aria-label={`Copy ${text}`}
    >
      <span>
        {prompt && <span className="mr-1.5 text-[#F7931A]/45">$</span>}
        {text}
      </span>
      <svg
        width="14"
        height="14"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        style={{ opacity: 0.6 }}
      >
        {copied ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        )}
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------
 * Eyebrow — small all-caps section label
 * ------------------------------------------------------------------ */

export function Eyebrow({
  children,
  live = false,
  className = "",
}: {
  children: React.ReactNode;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={`eyebrow ${className}`}>
      {live && <span className="status-dot align-middle mr-2" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------
 * LevelChip — colored pill for level (Registered / Genesis / etc)
 * Mirrors the design system (chips per level number).
 * ------------------------------------------------------------------ */

const LEVEL_PALETTE: Record<
  string,
  { bg: string; fg: string; bd: string }
> = {
  unverified: {
    bg: "rgba(255,255,255,0.04)",
    fg: "rgba(255,255,255,0.45)",
    bd: "rgba(255,255,255,0.08)",
  },
  registered: {
    bg: "rgba(247,147,26,0.12)",
    fg: "var(--orange)",
    bd: "rgba(247,147,26,0.35)",
  },
  genesis: {
    bg: "rgba(125,162,255,0.12)",
    fg: "var(--blue)",
    bd: "rgba(125,162,255,0.35)",
  },
};

export function LevelChip({
  level,
  levelName,
  className = "",
}: {
  level: number;
  levelName?: string | null;
  className?: string;
}) {
  const name = (levelName || levelByNumber(level)).toLowerCase();
  const palette = LEVEL_PALETTE[name] || LEVEL_PALETTE.unverified;
  const display = levelName || levelByNumber(level);
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] ${className}`}
      style={{
        background: palette.bg,
        color: palette.fg,
        borderColor: palette.bd,
        fontFamily: "var(--mono)",
      }}
    >
      {display}
    </span>
  );
}

function levelByNumber(n: number): string {
  if (n >= 2) return "Genesis";
  if (n >= 1) return "Registered";
  return "Unverified";
}

/* ------------------------------------------------------------------
 * Avatar — deterministic gradient initials from a seed string
 * ------------------------------------------------------------------ */

export function Avatar({
  seed,
  size = 34,
  className = "",
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const safe = seed && seed.length > 0 ? seed : "?";
  const h1 = (safe.charCodeAt(0) * 37) % 360;
  const h2 = (safe.charCodeAt(Math.min(1, safe.length - 1)) * 47) % 360;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${h1},50%,40%), hsl(${h2},40%,22%))`,
        borderColor: "rgba(255,255,255,0.08)",
        fontFamily: "var(--mono)",
        fontSize: size * 0.32,
        color: "rgba(255,255,255,0.8)",
      }}
    >
      {safe.slice(0, 2).toUpperCase()}
    </div>
  );
}

/* ------------------------------------------------------------------
 * BgLayers — fixed background grid + radial aura, matches design
 * ------------------------------------------------------------------ */

export function BgLayers() {
  return (
    <>
      <div className="bg-aura" aria-hidden />
      <div className="bg-grid" aria-hidden />
    </>
  );
}

/* ------------------------------------------------------------------
 * Seg — segmented control used by inner pages for filters/sorts
 * ------------------------------------------------------------------ */

export function Seg<T extends string>({
  value,
  onChange,
  opts,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  opts: ReadonlyArray<readonly [T, React.ReactNode]>;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex gap-0.5 rounded-[10px] border p-[3px] ${className}`}
      style={{
        background: "rgba(0,0,0,0.3)",
        borderColor: "var(--line-2)",
      }}
    >
      {opts.map(([v, label]) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className="rounded-[7px] px-3 py-[7px] text-[12px] transition-colors"
            style={{
              fontFamily: "var(--mono)",
              color: active ? "var(--orange)" : "var(--text-dim)",
              background: active ? "rgba(247,147,26,0.12)" : "transparent",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
