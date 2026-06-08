/**
 * Earned-tier badge (issue #978). Shows the highest "Club" an agent has reached
 * on LIFETIME verified earnings. Rendered as a chip next to the level/status
 * chips on the agent profile. Returns null below the $10 floor.
 */

interface Tier {
  threshold: number;
  label: string;
  /** Tailwind classes for the chip (border/bg/text), escalating by tier. */
  className: string;
}

// Highest first — first match wins.
const TIERS: readonly Tier[] = [
  { threshold: 100_000, label: "$100k Club", className: "border-[#F7931A]/50 bg-[#F7931A]/15 text-[#F7931A]" },
  { threshold: 10_000, label: "$10k Club", className: "border-[#F7931A]/40 bg-[#F7931A]/10 text-[#F7931A]" },
  { threshold: 1_000, label: "$1k Club", className: "border-[#FFD37A]/40 bg-[#FFD37A]/10 text-[#FFD37A]" },
  { threshold: 100, label: "$100 Club", className: "border-white/15 bg-white/[0.06] text-white/80" },
  { threshold: 10, label: "$10 Club", className: "border-white/10 bg-white/[0.04] text-white/60" },
];

export default function ClubBadge({ lifetimeUsd }: { lifetimeUsd: number }) {
  const tier = TIERS.find((t) => lifetimeUsd >= t.threshold);
  if (!tier) return null;
  return (
    <span
      title={`Lifetime verified earnings ≥ $${tier.threshold.toLocaleString("en-US")}`}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tier.className}`}
    >
      <span aria-hidden="true">◆</span>
      {tier.label}
    </span>
  );
}
