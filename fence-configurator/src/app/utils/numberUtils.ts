/** Rounds to the given number of decimals — the one shared guard behind
 * every "no more than N digits after the point" constraint below. */
export function roundToDecimals(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Formats to `decimals` places, then trims trailing zeros (and a bare
 * trailing dot) so a whole number reads as "6", not "6.000". */
export function formatTrimmed(n: number, decimals: number): string {
  return n
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

/** Applied to a free-typed decimal field on every keystroke — truncates
 * anything past `maxDecimals` digits after the point, so it's never
 * possible to type a second/third decimal digit in the first place. */
export function clampDecimalString(raw: string, maxDecimals: number): string {
  const dot = raw.indexOf('.');
  if (dot === -1) return raw;
  return raw.slice(0, dot + 1 + maxDecimals);
}
