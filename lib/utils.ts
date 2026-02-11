/**
 * Shared utility functions for AIBTC pages.
 */

/**
 * Truncate a long address to a shorter display format.
 * @param address - The full address string
 * @param length - Optional length threshold (default: 16)
 * @returns Truncated address or original if short enough
 */
export function truncateAddress(address: string, length: number = 16): string {
  if (address.length <= length) return address;
  const prefixLength = Math.floor(length / 2);
  const suffixLength = Math.floor(length / 2);
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

/**
 * Update or create a meta tag in the document head.
 * Used for dynamically updating SEO and Open Graph metadata.
 * @param name - The meta tag name or property
 * @param content - The content value
 * @param property - Whether to use property attribute instead of name
 */
export function updateMeta(name: string, content: string, property?: boolean): void {
  const attr = property ? 'property' : 'name';
  let meta = document.querySelector(`meta[${attr}="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attr, name);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

/**
 * Format a timestamp as relative time (e.g., "2 min ago", "1 hour ago").
 * @param timestamp - ISO 8601 timestamp string
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec} sec ago`;
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Compute activity status based on lastActiveAt timestamp.
 * Returns color and label for activity indicator.
 * @param lastActiveAt - ISO 8601 timestamp string or undefined
 * @returns Activity status { color, label }
 */
export function getActivityStatus(
  lastActiveAt: string | undefined
): { color: string; label: string } {
  if (!lastActiveAt) {
    return { color: "rgba(255,255,255,0.3)", label: "Never active" };
  }

  const now = Date.now();
  const then = new Date(lastActiveAt).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 10) {
    return { color: "#22c55e", label: "Active now" };
  }
  if (diffMin < 60) {
    return { color: "#eab308", label: "Recently active" };
  }
  return { color: "rgba(255,255,255,0.3)", label: "Inactive" };
}
