import { describe, it, expect } from 'vitest';
import { computeBoardStack, ResolvedBoardDims } from './field';
import golden from './__fixtures__/golden.json';

/** See shape.test.ts's header comment — same golden-baseline policy applies here. */

const typeSingle: ResolvedBoardDims = { modelId: 'type-1', sizeId: 'size-1', boardHeightCm: 7, spacerHeightCm: 1 };
const typeA: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-1', boardHeightCm: 4, spacerHeightCm: 1 };
const typeB: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-2', boardHeightCm: 2, spacerHeightCm: 1 };
const wide: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-1', boardHeightCm: 4, spacerHeightCm: 1 };
const narrow: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-2', boardHeightCm: 2, spacerHeightCm: 1 };

describe('computeBoardStack — golden baseline', () => {
  it('A: single board type fills toward the closing height, no top margin', () => {
    expect(computeBoardStack(180, () => [typeSingle])).toEqual(golden.boardStackA_singleType);
  });

  it('B: mixed profile types — steps 0-2 one type, steps 3+ another, transition is clean', () => {
    expect(computeBoardStack(60, (stepIndex) => (stepIndex < 3 ? [typeA] : [typeB]))).toEqual(
      golden.boardStackB_mixedProfiles,
    );
  });

  it('C: candidate fallback (wide, then narrow) closes a leftover gap the wide type alone could not', () => {
    expect(computeBoardStack(23, () => [wide, narrow])).toEqual(golden.boardStackC_fallbackNarrowsToFitGap);
  });
});

describe('computeBoardStack — invariants (business rules, not just numbers)', () => {
  it('never exceeds the requested closing height', () => {
    const stack = computeBoardStack(100, () => [{ modelId: 'x', sizeId: 'y', boardHeightCm: 11, spacerHeightCm: 1 }]);
    expect(stack.filledHeightCm).toBeLessThanOrEqual(100);
  });

  it('the first (bottom) board never gets a spacer below it — nothing to space from', () => {
    const stack = computeBoardStack(180, () => [typeSingle]);
    expect(stack.boards[0].spacerBelowCm).toBe(0);
  });

  it('no board is ever cut/split — every placed board keeps its full catalog height', () => {
    const stack = computeBoardStack(50, () => [{ modelId: 'x', sizeId: 'y', boardHeightCm: 7, spacerHeightCm: 1 }]);
    for (const b of stack.boards) expect(b.boardHeightCm).toBe(7);
  });

  it('stepIndex is a simple 0-based bottom-up counter matching array position', () => {
    const stack = computeBoardStack(180, () => [typeSingle]);
    stack.boards.forEach((b, i) => expect(b.stepIndex).toBe(i));
  });

  it('a target height of 0 (or less than the rosette offset) places no boards', () => {
    const stack = computeBoardStack(1, () => [typeSingle]);
    expect(stack.boards).toHaveLength(0);
  });
});
