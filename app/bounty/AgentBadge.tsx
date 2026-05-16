import { truncAddr } from "./utils";

/**
 * Avatar + display name pill for a BTC address.
 *
 * Used on bounty cards, the bounty detail page (poster + winner + each
 * submission row), and anywhere we need to surface an agent's identity from
 * just a raw address. Falls back to a truncated address when no display name
 * is known (e.g. the address belongs to someone who hasn't registered).
 *
 * Avatar source follows the codebase convention (Leaderboard, AgentStrip,
 * ActivityFeedHero, InteractionGraph): bitcoinfaces.xyz.
 */
export default function AgentBadge({
  address,
  name,
  size = "sm",
  textClass = "text-white/60",
}: {
  address: string;
  name?: string;
  size?: "xs" | "sm" | "md";
  textClass?: string;
}) {
  const imgSizeClass = size === "xs" ? "size-4" : size === "md" ? "size-6" : "size-5";
  const gapClass = size === "xs" ? "gap-1" : "gap-1.5";
  return (
    <span className={`inline-flex items-center min-w-0 ${gapClass}`}>
      <img
        src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(address)}`}
        alt=""
        role="presentation"
        className={`${imgSizeClass} shrink-0 rounded-full bg-white/[0.04] object-cover`}
        loading="lazy"
      />
      <span className={`truncate ${textClass}`}>{name ?? truncAddr(address)}</span>
    </span>
  );
}
