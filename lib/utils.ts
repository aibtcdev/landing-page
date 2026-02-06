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
