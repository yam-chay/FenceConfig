import { describe, it, expect } from 'vitest';
import { computeBoardStack, type ResolvedBoardDims } from './field';
import { ROSETTE_OFFSET_CM } from './constants';
import golden from './__fixtures__/golden.json';

// Golden policy: see shape.test.ts header.

const typeSingle: ResolvedBoardDims = { modelId: 'type-1', sizeId: 'size-1', boardHeightCm: 7, spacerHeightCm: 1 };
const typeA: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-1', boardHeightCm: 4, spacerHeightCm: 1 };
const typeB: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-2', boardHeightCm: 2, spacerHeightCm: 1 };

/** Mirrors the app: step 0 starts at spacer 0 by default. */
function startAtZero(dims: ResolvedBoardDims): ResolvedBoardDims {
  return { ...dims, spacerHeightCm: 0, baseSpacerHeightCm: dims.spacerHeightCm, spacerMultiplier: 0 };
}

/** One type for every step, app-style default start. */
function uniform(dims: ResolvedBoardDims) {
  return (stepIndex: number) => [stepIndex === 0 ? startAtZero(dims) : dims];
}

/** Explicitly doubled spacer — what a user-set rule produces. */
function doubled(dims: ResolvedBoardDims): ResolvedBoardDims {
  return { ...dims, spacerHeightCm: dims.spacerHeightCm * 2, baseSpacerHeightCm: dims.spacerHeightCm, spacerMultiplier: 2 };
}

describe('computeBoardStack — golden baseline', () => {
  it('A: single type, closes toward the requested height', () => {
    expect(computeBoardStack(180, uniform(typeSingle))).toEqual(golden.boardStackA_singleType);
  });

  it('B: mixed profiles — steps 0-2 one type, 3+ another', () => {
    const resolve = (i: number) => [i === 0 ? startAtZero(typeA) : i < 3 ? typeA : typeB];
    expect(computeBoardStack(60, resolve)).toEqual(golden.boardStackB_mixedProfiles);
  });

  it('C: primary alone leaves a gap, closure closes it', () => {
    expect(computeBoardStack(23, uniform(typeA))).toEqual(golden.boardStackC_fallbackNarrowsToFitGap);
  });
});

describe('computeBoardStack — invariants (business rules, not just numbers)', () => {
  it('never exceeds the requested closing height', () => {
    const stack = computeBoardStack(100, uniform({ modelId: 'x', sizeId: 'y', boardHeightCm: 11, spacerHeightCm: 1 }));
    expect(stack.filledHeightCm).toBeLessThanOrEqual(100);
  });

  it('closure never touches step 0 — default start stays 0', () => {
    const stack = computeBoardStack(180, uniform(typeSingle));
    expect(stack.boards[0].spacerBelowCm).toBe(0);
  });

  it('a raised start spacer is kept exactly as set', () => {
    const resolve = (i: number) => [i === 0 ? doubled(typeSingle) : typeSingle];
    const stack = computeBoardStack(180, resolve);
    expect(stack.boards[0].spacerBelowCm).toBe(2);
  });

  it('an explicitly set spacer (multiplier ≠ 1) is never widened', () => {
    const resolve = (i: number) => [i === 0 ? startAtZero(typeSingle) : i === 3 ? doubled(typeSingle) : typeSingle];
    const stack = computeBoardStack(180, resolve);
    expect(stack.boards[3].spacerBelowCm).toBe(2);
  });

  it('prefers widening spacers over an extra board when spacers alone close it', () => {
    // rosette + 7 + 21×8, then exactly 2 cm left; 21 widenable spacers.
    const target = ROSETTE_OFFSET_CM + 7 + 21 * 8 + 2;
    const stack = computeBoardStack(target, uniform(typeSingle));
    expect(stack.filledHeightCm).toBe(target);
    expect(stack.boards).toHaveLength(22);
    expect(stack.boards.every((b) => b.modelId === 'type-1' && b.sizeId === 'size-1')).toBe(true);
  });

  it('no board is ever cut/split — every placed board keeps its full catalog height', () => {
    const stack = computeBoardStack(50, uniform({ modelId: 'x', sizeId: 'y', boardHeightCm: 7, spacerHeightCm: 1 }));
    for (const b of stack.boards) expect(b.boardHeightCm).toBe(7);
  });

  it('stepIndex is a simple 0-based bottom-up counter matching array position', () => {
    const stack = computeBoardStack(180, uniform(typeSingle));
    stack.boards.forEach((b, i) => expect(b.stepIndex).toBe(i));
  });

  it('a target height below the rosette offset places no boards', () => {
    const stack = computeBoardStack(1, uniform(typeSingle));
    expect(stack.boards).toHaveLength(0);
  });
});