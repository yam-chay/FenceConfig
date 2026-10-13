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

  it('closes with ONE final step and never re-spaces the boards below it', () => {
    // rosette + 7 + 21×8, then exactly 2 cm left.
    const target = ROSETTE_OFFSET_CM + 7 + 21 * 8 + 2;
    const stack = computeBoardStack(target, uniform(typeSingle));
    expect(stack.filledHeightCm).toBe(target);
    const below = stack.boards.slice(0, -1);
    expect(below.every((b, i) => b.spacerBelowCm === (i === 0 ? 0 : 1))).toBe(true);
    expect(below.some((b) => b.closure)).toBe(false);
    expect(stack.boards.at(-1)!.closure).toBe(true);
  });

  it('too small a remainder for any step on top → the last step is replaced (its own spacer may change)', () => {
    // 1 cm left over a type-1 column: nothing that small exists, but a
    // 7cm board over a doubled spacer closes it in place of the last step.
    const target = ROSETTE_OFFSET_CM + 7 + 10 * 8 + 1;
    const stack = computeBoardStack(target, uniform(typeSingle));
    expect(stack.filledHeightCm).toBe(target);
    expect(stack.boards).toHaveLength(11);
    const top = stack.boards.at(-1)!;
    expect(top).toMatchObject({ modelId: 'type-1', boardHeightCm: 7, spacerBelowCm: 2, closure: true });
  });

  it('whole-cm fills always close exactly with the current catalog', () => {
    for (let fill = 20; fill <= 200; fill++) {
      expect(computeBoardStack(fill, uniform(typeSingle)).filledHeightCm).toBe(fill);
    }
  });

  it('a fill that no part combination reaches leaves the smallest gap, never more than 1 cm', () => {
    for (let tenths = 200; tenths <= 2000; tenths++) {
      const stack = computeBoardStack(tenths / 10, uniform(typeSingle));
      const gap = tenths / 10 - stack.filledHeightCm;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(1);
    }
  });

  it('a user-set step that does not fit is placed anyway and flagged as overflowing', () => {
    const tall: ResolvedBoardDims = { ...typeSingle, explicit: true };
    const fill = ROSETTE_OFFSET_CM + 7 + 10 * 8 + 3; // 3 cm left — an 8cm step overflows by 5
    const resolve = (i: number) => [i === 0 ? startAtZero(typeSingle) : i === 11 ? tall : typeSingle];
    const stack = computeBoardStack(fill, resolve);
    expect(stack.overflowCm).toBe(5);
    expect(stack.boards.at(-1)).toMatchObject({ stepIndex: 11, overflow: true });
    expect(stack.boards.some((b) => b.closure)).toBe(false);
  });

  it('a user-set last step is never replaced by the closure', () => {
    const fill = ROSETTE_OFFSET_CM + 7 + 10 * 8 + 1;
    const resolve = (i: number) => [i === 0 ? startAtZero(typeSingle) : i === 10 ? { ...typeSingle, explicit: true } : typeSingle];
    const stack = computeBoardStack(fill, resolve);
    expect(stack.boards[10]).toMatchObject({ spacerBelowCm: 1 });
    expect(stack.boards[10].closure).toBeUndefined();
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