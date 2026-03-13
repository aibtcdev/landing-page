/* ─── Shared Bounty Utilities ─── */

/* ─── Status styling ─── */

export const STATUS_STYLES: Record<string, string> = {
  open: "text-emerald-400/90 bg-emerald-400/[0.08] border-emerald-400/20",
  claimed: "text-[#7DA2FF]/90 bg-[#7DA2FF]/[0.08] border-[#7DA2FF]/20",
  submitted: "text-purple-400/90 bg-purple-400/[0.08] border-purple-400/20",
  approved: "text-amber-400/90 bg-amber-400/[0.08] border-amber-400/20",
  paid: "text-[#F7931A]/90 bg-[#F7931A]/[0.08] border-[#F7931A]/20",
  cancelled: "text-white/40 bg-white/[0.04] border-white/[0.06]",
  active: "text-emerald-400/90 bg-emerald-400/[0.08] border-emerald-400/20",
  rejected: "text-red-400/90 bg-red-400/[0.08] border-red-400/20",
  pending: "text-amber-400/90 bg-amber-400/[0.08] border-amber-400/20",
  confirmed: "text-emerald-400/90 bg-emerald-400/[0.08] border-emerald-400/20",
  withdrawn: "text-white/40 bg-white/[0.04] border-white/[0.06]",
  failed: "text-red-400/90 bg-red-400/[0.08] border-red-400/20",
};

export function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
}

/* ─── Formatting helpers ─── */

export function formatSats(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

export function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function deadlineLabel(deadline: string | null): string | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff < 0) return "Expired";
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
