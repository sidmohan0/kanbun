import { generateKeyBetween } from "fractional-indexing";

/** First key for an empty list. */
export const firstKey = (): string => generateKeyBetween(null, null);

/** A key after the largest of `keys` (or the first key if none). */
export function keyAfter(keys: Iterable<string>): string {
  let max: string | null = null;
  for (const k of keys) if (max === null || k > max) max = k;
  return generateKeyBetween(max, null);
}

/** A key before the smallest of `keys`. */
export function keyBefore(keys: Iterable<string>): string {
  let min: string | null = null;
  for (const k of keys) if (min === null || k < min) min = k;
  return generateKeyBetween(null, min);
}

export { generateKeyBetween };

/** Key after a single known maximum (from Store.maxOf), or the first key. */
export const afterMax = (max: string | undefined): string => generateKeyBetween(max ?? null, null);
/** Key before a single known minimum (from Store.minOf), or the first key. */
export const beforeMin = (min: string | undefined): string => generateKeyBetween(null, min ?? null);
