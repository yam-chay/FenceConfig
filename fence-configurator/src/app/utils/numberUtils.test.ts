import { describe, it, expect } from 'vitest';
import { roundToDecimals, formatTrimmed, clampDecimalString } from './numberUtils';
import golden from '../__fixtures__/golden.json';

/** See app/defaults.test.ts's header comment — same golden-baseline policy applies here. */

describe('roundToDecimals — golden baseline', () => {
  it('simple 2-decimal round', () => {
    expect(roundToDecimals(1.2345, 2)).toBe(golden.roundToDecimals.simple);
  });
  it('half-up rounding at 1 decimal', () => {
    expect(roundToDecimals(0.05, 1)).toBe(golden.roundToDecimals.halfUp);
  });
  it('0 decimals rounds to a whole number', () => {
    expect(roundToDecimals(4.7, 0)).toBe(golden.roundToDecimals.zeroDecimals);
  });
  it('negative numbers', () => {
    expect(roundToDecimals(-1.2345, 2)).toBe(golden.roundToDecimals.negative);
  });
  it('already-exact value is unchanged', () => {
    expect(roundToDecimals(3, 2)).toBe(golden.roundToDecimals.alreadyExact);
  });
});

describe('formatTrimmed — golden baseline', () => {
  it('a whole number shows no decimal point at all', () => {
    expect(formatTrimmed(6, 3)).toBe(golden.formatTrimmed.wholeNumber_noTrailingZeros);
  });
  it('trims trailing zeros past the meaningful digit', () => {
    expect(formatTrimmed(6.5, 3)).toBe(golden.formatTrimmed.oneDecimal_trimsRest);
  });
  it('trims a single trailing zero', () => {
    expect(formatTrimmed(6.1, 3)).toBe(golden.formatTrimmed.exactDecimals_trimsTrailingZero);
  });
  it('all zeros after the point collapses to the whole number, no dangling dot', () => {
    expect(formatTrimmed(6.0, 1)).toBe(golden.formatTrimmed.allZerosAfterPoint);
  });
  it('small decimal values', () => {
    expect(formatTrimmed(0.5, 1)).toBe(golden.formatTrimmed.smallDecimals);
  });
  it('rounds before trimming (1.999 at 2 decimals)', () => {
    expect(formatTrimmed(1.999, 2)).toBe(golden.formatTrimmed.roundedUp);
  });
});

describe('clampDecimalString — golden baseline', () => {
  it('no dot in the string -> unchanged', () => {
    expect(clampDecimalString('12', 1)).toBe(golden.clampDecimalString.noDot_unchanged);
  });
  it('already within the limit -> unchanged', () => {
    expect(clampDecimalString('12.3', 1)).toBe(golden.clampDecimalString.withinLimit_unchanged);
  });
  it('over the limit -> truncated, not rounded', () => {
    expect(clampDecimalString('12.3456', 1)).toBe(golden.clampDecimalString.overLimit_truncated);
  });
  it('exactly at the limit -> unchanged', () => {
    expect(clampDecimalString('12.34', 2)).toBe(golden.clampDecimalString.exactlyAtLimit_unchanged);
  });
  it('a trailing dot with no digits after it is left as-is', () => {
    expect(clampDecimalString('12.', 1)).toBe(golden.clampDecimalString.dotAtEnd_noDigitsAfter);
  });
});

describe('numberUtils — invariants', () => {
  it('formatTrimmed never leaves a bare trailing dot', () => {
    expect(formatTrimmed(6, 3)).not.toMatch(/\.$/);
    expect(formatTrimmed(6.0, 1)).not.toMatch(/\.$/);
  });
  it('clampDecimalString never lengthens a string, only shortens or leaves it as-is', () => {
    const raw = '12.3456';
    expect(clampDecimalString(raw, 1).length).toBeLessThanOrEqual(raw.length);
  });
});
