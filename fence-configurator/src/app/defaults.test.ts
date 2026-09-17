import { describe, it, expect } from 'vitest';
import { defaultShape, defaultColorScheme, defaultProfileScheme, heightForBoardCount, FENCE_COLORS } from './defaults';
import golden from './__fixtures__/golden.json';

/**
 * Golden-baseline regression tests for app/defaults.ts — same policy as
 * geometry/shape.test.ts's header comment: these pin the behavior captured
 * from App.tsx BEFORE the stage-1 extraction (2026-09-17). A failure here
 * after moving code means the move changed something — fix the code, not
 * the fixture, unless the change was deliberate (see generate-golden.ts).
 */

describe('defaultShape / defaultColorScheme / defaultProfileScheme — golden baseline', () => {
  it('defaultShape matches the pre-extraction shape exactly', () => {
    expect(defaultShape()).toEqual(golden.defaultShape);
  });
  it('defaultColorScheme matches the pre-extraction scheme exactly', () => {
    expect(defaultColorScheme()).toEqual(golden.defaultColorScheme);
  });
  it('defaultProfileScheme matches the pre-extraction scheme exactly', () => {
    expect(defaultProfileScheme()).toEqual(golden.defaultProfileScheme);
  });
  it('FENCE_COLORS keeps its length and first entry (used as the default color)', () => {
    expect(FENCE_COLORS.length).toBe(golden.fenceColorsLength);
    expect(FENCE_COLORS[0]).toEqual(golden.fenceColorsFirst);
  });
});

describe('heightForBoardCount — golden baseline', () => {
  it('base 0, one board', () => {
    expect(heightForBoardCount(0, 1, 7, 1)).toBe(golden.heightForBoardCount.baseZero_oneBoard);
  });
  it('base 0, five boards', () => {
    expect(heightForBoardCount(0, 5, 7, 1)).toBe(golden.heightForBoardCount.baseZero_fiveBoards);
  });
  it('non-zero base, five boards', () => {
    expect(heightForBoardCount(35, 5, 7, 1)).toBe(golden.heightForBoardCount.baseNonZero_fiveBoards);
  });
  it('boardCount 0 is treated as 1 (never fewer than one board)', () => {
    expect(heightForBoardCount(0, 0, 7, 1)).toBe(golden.heightForBoardCount.boardCountZero_treatedAsOne);
  });
  it('negative boardCount is also treated as 1', () => {
    expect(heightForBoardCount(0, -3, 7, 1)).toBe(golden.heightForBoardCount.boardCountNegative_treatedAsOne);
  });
  it('a different board/spacer dims pair', () => {
    expect(heightForBoardCount(10, 14, 4, 1)).toBe(golden.heightForBoardCount.differentDims);
  });
});

describe('defaults — invariants', () => {
  it('defaultShape always has exactly one leg and no junctions', () => {
    const shape = defaultShape();
    expect(shape.legs).toHaveLength(1);
    expect(shape.junctions).toHaveLength(0);
  });
  it('defaultColorScheme starts with no per-board override rules', () => {
    expect(defaultColorScheme().boardRules).toEqual([]);
  });
  it('heightForBoardCount is monotonically non-decreasing in boardCount', () => {
    const h1 = heightForBoardCount(0, 1, 7, 1);
    const h2 = heightForBoardCount(0, 2, 7, 1);
    const h3 = heightForBoardCount(0, 3, 7, 1);
    expect(h2).toBeGreaterThan(h1);
    expect(h3).toBeGreaterThan(h2);
  });
});
