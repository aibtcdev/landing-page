/**
 * Deterministic address hashing and seeded PRNG.
 *
 * No external dependencies -- pure math operations only.
 * Works with any address format (Bitcoin bc1..., Stacks SP.../ST..., etc.)
 */

/**
 * Hash an address string into a 32-bit unsigned integer using FNV-1a.
 *
 * FNV-1a has better avalanche properties than djb2 for short strings,
 * which means small address differences produce very different hashes.
 */
export function hashAddress(address: string): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < address.length; i++) {
    hash ^= address.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Ensure unsigned 32-bit
  return hash >>> 0;
}

/**
 * Create a seeded pseudo-random number generator (Mulberry32).
 *
 * Returns a function that produces sequential deterministic 32-bit
 * unsigned integers. Each call advances the internal state.
 *
 * Mulberry32 passes BigCrush and has a full 2^32 period, which is
 * more than enough for name selection from word lists.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

/**
 * Select an index from a list of the given length using modular arithmetic.
 *
 * Takes a random value and maps it uniformly to [0, length).
 * For lists under ~65K entries and 32-bit random values, modulo bias
 * is negligible (<0.002%).
 */
export function selectIndex(randomValue: number, length: number): number {
  return randomValue % length;
}
