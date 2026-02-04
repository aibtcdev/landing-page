/**
 * Deterministic Name Generator
 *
 * Generates whimsical, deterministic names from Bitcoin/Stacks addresses.
 * The same address always produces the same name with no external dependencies.
 *
 * @example
 * ```ts
 * import { generateName } from "@/lib/name-generator";
 *
 * const name = generateName("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
 * // => "Crimson Phoenix Herald"
 * ```
 *
 * @module
 */

export { generateName, generateNameDetailed } from "./generator";
export type { GenerateNameOptions, GeneratedName } from "./generator";
export { hashAddress, createSeededRng, selectIndex } from "./hash";
export { ADJECTIVES, NOUNS, EPITHETS, TOTAL_COMBINATIONS } from "./word-lists";
