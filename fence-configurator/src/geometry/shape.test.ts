import { describe, it, expect } from 'vitest';
import { fieldCountForLeg, layoutShape, Shape } from './shape';
import golden from './__fixtures__/golden.json';

/**
 * Golden-baseline regression tests for shape.ts.
 *
 * These pin the CURRENT output of fieldCountForLeg / layoutShape, captured
 * directly from the running code on 2026-09-17 (see __fixtures__/golden.json
 * and generate-golden.ts). They exist to survive the code refactor
 * described in the "תוכנית ריפקטור ואופטימיזציה — Fence Configurator" plan —
 * NOT as a spec for what's "correct". If a test here fails after a
 * refactor step, the fix is almost always to make the code match the
 * fixture again, not to update the fixture.
 *
 * The ONLY time the fixture should change is a deliberate, reviewed
 * business-logic change — in that case, rerun `npx tsx generate-golden.ts`
 * and diff the result by hand before committing it.
 */

describe('fieldCountForLeg — golden baseline', () => {
  it('short leg, both ends true end posts', () => {
    expect(fieldCountForLeg(1.0, false, false)).toBe(golden.fieldCountForLeg.shortLeg_endEnd);
  });
  it('leg length exactly at the per-field cap, end/end', () => {
    expect(fieldCountForLeg(1.5, false, false)).toBe(golden.fieldCountForLeg.atCapBoundary_endEnd);
  });
  it('leg length just over the per-field cap, end/end', () => {
    expect(fieldCountForLeg(1.51, false, false)).toBe(golden.fieldCountForLeg.justOverCap_endEnd);
  });
  it('long leg, end/end', () => {
    expect(fieldCountForLeg(6.0, false, false)).toBe(golden.fieldCountForLeg.longLeg_endEnd);
  });
  it('long leg, middle/middle (both sides are shared posts)', () => {
    expect(fieldCountForLeg(6.0, true, true)).toBe(golden.fieldCountForLeg.longLeg_middleMiddle);
  });
  it('long leg, middle/end (one shared side, one true end)', () => {
    expect(fieldCountForLeg(6.0, true, false)).toBe(golden.fieldCountForLeg.longLeg_middleEnd);
  });
  it('very long leg, middle/middle — margin accumulation over many internal fields', () => {
    expect(fieldCountForLeg(20.0, true, true)).toBe(golden.fieldCountForLeg.veryLong_middleMiddle);
  });
  it('tiny leg, middle/middle — never collapses to 0 fields', () => {
    expect(fieldCountForLeg(0.3, true, true)).toBe(golden.fieldCountForLeg.tiny_middleMiddle);
  });
});

describe('fieldCountForLeg — invariants (the business rule, not just the numbers)', () => {
  it('never returns fewer than 1 field, even for a near-zero leg', () => {
    expect(fieldCountForLeg(0.01, true, true)).toBeGreaterThanOrEqual(1);
  });
  it('a middle/middle leg never needs FEWER fields than the same leg end/end (middle margin only adds cost)', () => {
    const middle = fieldCountForLeg(6.0, true, true);
    const end = fieldCountForLeg(6.0, false, false);
    expect(middle).toBeGreaterThanOrEqual(end);
  });
});

const legA = { lengthM: 3, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 };

describe('layoutShape — golden baseline scenarios', () => {
  it('A: single short leg, no junction', () => {
    const shape: Shape = { legs: [{ ...legA, lengthM: 3 }], junctions: [] };
    expect(layoutShape(shape)).toEqual(golden.layoutShapeA_singleShortLeg);
  });

  it('B: single long leg, internal split (middle-margin accumulation within one leg)', () => {
    const shape: Shape = { legs: [{ ...legA, lengthM: 10 }], junctions: [] };
    expect(layoutShape(shape)).toEqual(golden.layoutShapeB_longLegInternalSplit);
  });

  it('C: two legs joined by a straight junction (merged middle post)', () => {
    const shape: Shape = {
      legs: [
        { ...legA, lengthM: 4 },
        { ...legA, lengthM: 5 },
      ],
      junctions: [{ type: 'straight' }],
    };
    expect(layoutShape(shape)).toEqual(golden.layoutShapeC_straightJunction);
  });

  it('D: two legs joined by a left (90°) corner — double post, perpendicular heading', () => {
    const shape: Shape = {
      legs: [
        { ...legA, lengthM: 4 },
        { ...legA, lengthM: 3 },
      ],
      junctions: [{ type: 'left' }],
    };
    expect(layoutShape(shape)).toEqual(golden.layoutShapeD_leftCorner);
  });

  it('E: two legs joined by disconnect, DIFFERENT base heights — two independent posts', () => {
    const shape: Shape = {
      legs: [
        { ...legA, lengthM: 4 },
        { ...legA, lengthM: 4, baseHeightCm: 20 },
      ],
      junctions: [{ type: 'disconnect' }],
    };
    expect(layoutShape(shape)).toEqual(golden.layoutShapeE_disconnectDifferentBase);
  });

  it('F: leg starting on an existing wall (baseHeightCm > 0) — fillHeightCm shrinks accordingly', () => {
    const shape: Shape = { legs: [{ ...legA, lengthM: 5, baseHeightCm: 35, wallWidthCm: 12 }], junctions: [] };
    expect(layoutShape(shape)).toEqual(golden.layoutShapeF_existingWallBase);
  });

  it('G: three legs, straight junction into a corner, mixed catalog models/heights', () => {
    const shape: Shape = {
      legs: [
        { ...legA, lengthM: 3 },
        { lengthM: 4, baseHeightCm: 0, heightCm: 160, modelId: 'type-2', sizeId: 'size-1', wallWidthCm: 10 },
        { lengthM: 2.5, baseHeightCm: 0, heightCm: 160, modelId: 'type-2', sizeId: 'size-1', wallWidthCm: 10 },
      ],
      junctions: [{ type: 'straight' }, { type: 'right' }],
    };
    expect(layoutShape(shape)).toEqual(golden.layoutShapeG_threeLegsMixed);
  });
});

describe('layoutShape — invariants (business rules, not just numbers)', () => {
  it('boardLengthM is always shorter than fieldLengthM — margins subtract, never add', () => {
    const shape: Shape = { legs: [{ ...legA, lengthM: 6 }], junctions: [] };
    const { fields } = layoutShape(shape);
    for (const f of fields) expect(f.boardLengthM).toBeLessThan(f.lengthM);
  });

  it('a straight/left/right junction merges into exactly ONE double post, never two separate posts', () => {
    const shape: Shape = {
      legs: [
        { ...legA, lengthM: 3 },
        { ...legA, lengthM: 3 },
      ],
      junctions: [{ type: 'straight' }],
    };
    const { posts } = layoutShape(shape);
    const doublePosts = posts.filter((p) => p.isDoublePost);
    expect(doublePosts).toHaveLength(1);
    expect(doublePosts[0].legIndices).toEqual([0, 1]);
  });

  it('a disconnect junction never produces isDoublePost, even with equal base heights', () => {
    const shape: Shape = {
      legs: [
        { ...legA, lengthM: 3 },
        { ...legA, lengthM: 3, baseHeightCm: 15 },
      ],
      junctions: [{ type: 'disconnect' }],
    };
    const { posts } = layoutShape(shape);
    expect(posts.some((p) => p.isDoublePost)).toBe(false);
    const endOfLeg0 = posts.find((p) => p.rosetteEnd === 'end' && p.legIndices.includes(0));
    const startOfLeg1 = posts.find((p) => p.rosetteEnd === 'start' && p.legIndices.includes(1));
    expect(endOfLeg0?.baseHeightCm).toBe(0);
    expect(startOfLeg1?.baseHeightCm).toBe(15);
  });

  it('a double post merges base height as MIN and top height as MAX of its two legs', () => {
    const shape: Shape = {
      legs: [
        { ...legA, baseHeightCm: 10, heightCm: 170 },
        { ...legA, baseHeightCm: 10, heightCm: 190 },
      ],
      junctions: [{ type: 'left' }],
    };
    const { posts } = layoutShape(shape);
    const dp = posts.find((p) => p.isDoublePost)!;
    expect(dp.baseHeightCm).toBe(10);
    expect(dp.heightCm).toBe(180);
  });

  it('junctions.length must be legs.length - 1 (implicit contract layoutShape relies on)', () => {
    const shape: Shape = { legs: [legA, legA, legA], junctions: [{ type: 'straight' }, { type: 'straight' }] };
    expect(shape.junctions.length).toBe(shape.legs.length - 1);
    expect(() => layoutShape(shape)).not.toThrow();
  });
});
