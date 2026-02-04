/**
 * Deterministic name generator for Bitcoin/Stacks addresses.
 *
 * Pure function: address in, whimsical name out.
 * The same address always produces the same name.
 */

import { hashAddress, createSeededRng, selectIndex } from "./hash";
import { ADJECTIVES, NOUNS, EPITHETS } from "./word-lists";

/** Options for name generation */
export interface GenerateNameOptions {
  /**
   * When true, generates a four-part name with two adjectives:
   *   "Cosmic Neon Falcon Spark"
   * Default is three-part:
   *   "Cosmic Falcon Spark"
   */
  middleName?: boolean;
}

/** Result of name generation with individual parts */
export interface GeneratedName {
  /** The full formatted name string */
  full: string;
  /** Individual word parts of the name */
  parts: string[];
}

/**
 * Capitalize the first letter of a word.
 */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Generate a deterministic, whimsical name from a blockchain address.
 *
 * @param address - A Bitcoin (bc1...) or Stacks (SP.../ST...) address
 * @param options - Optional configuration
 * @returns The generated name as a string
 *
 * @example
 * ```ts
 * generateName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
 * // => "Crimson Phoenix Herald"
 *
 * generateName("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", { middleName: true })
 * // => "Stellar Azure Dragon Forger"
 * ```
 */
export function generateName(
  address: string,
  options?: GenerateNameOptions
): string {
  return generateNameDetailed(address, options).full;
}

/**
 * Generate a deterministic name with detailed breakdown.
 *
 * Same as `generateName` but returns individual parts for flexible formatting.
 */
export function generateNameDetailed(
  address: string,
  options?: GenerateNameOptions
): GeneratedName {
  const seed = hashAddress(address);
  const rng = createSeededRng(seed);

  const parts: string[] = [];

  // First adjective (always present)
  const adj1 = ADJECTIVES[selectIndex(rng(), ADJECTIVES.length)];
  parts.push(capitalize(adj1));

  // Optional second adjective for middle name
  if (options?.middleName) {
    const adj2 = ADJECTIVES[selectIndex(rng(), ADJECTIVES.length)];
    parts.push(capitalize(adj2));
  }

  // Noun
  const noun = NOUNS[selectIndex(rng(), NOUNS.length)];
  parts.push(capitalize(noun));

  // Epithet
  const epithet = EPITHETS[selectIndex(rng(), EPITHETS.length)];
  parts.push(capitalize(epithet));

  return {
    full: parts.join(" "),
    parts,
  };
}
