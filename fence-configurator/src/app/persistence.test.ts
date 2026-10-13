import { describe, it, expect } from 'vitest';
import { parseShortLinkPath } from './persistence';
import { migrateSnapshot, isValidSnapshot, SNAPSHOT_VERSION } from './snapshot';
import { legFillHeightCm } from '../geometry/shape';

describe('parseShortLinkPath', () => {
  it('extracts the id from /v/<id>', () => {
    expect(parseShortLinkPath('/v/aB3dE9xZ')).toBe('aB3dE9xZ');
    expect(parseShortLinkPath('/v/aB3dE9xZ/')).toBe('aB3dE9xZ');
  });
  it('flags a malformed id as a broken short link', () => {
    expect(parseShortLinkPath('/v/')).toBeNull();
    expect(parseShortLinkPath('/v/ab')).toBeNull();
    expect(parseShortLinkPath('/v/aB3d-9xZ')).toBeNull();
  });
  it('ignores every other path (editor, legacy hash links)', () => {
    expect(parseShortLinkPath('/')).toBeUndefined();
    expect(parseShortLinkPath('/view')).toBeUndefined();
  });
});

/** A v1 save: heightCm measured from the ground, rule anchors from the ground. */
const v1 = {
  v: 1,
  shape: {
    legs: [
      { lengthM: 3, baseHeightCm: 0, heightCm: 113, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 12 },
      { lengthM: 3, baseHeightCm: 30, heightCm: 143, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 12 },
    ],
    junctions: [{ type: 'disconnect' }],
  },
  colorScheme: {
    postColorHex: '#000000',
    baseBoardColorHex: '#000000',
    boardRules: [
      { stepIndex: 3, anchorHeightCm: 30, colorHex: '#ffffff', direction: 'exact', scope: 'field', legIndex: 0, fieldIndex: 0 },
      { stepIndex: 3, anchorHeightCm: 60, colorHex: '#ffffff', direction: 'exact', scope: 'field', legIndex: 1, fieldIndex: 0 },
    ],
  },
  profileScheme: {
    rules: [],
    spacerRules: [
      { stepIndex: 2, anchorHeightCm: 50, multiplier: 2, direction: 'exact', scope: 'field', legIndex: 1, fieldIndex: 1 },
    ],
  },
};

describe('snapshot migration v1 → v2', () => {
  const migrated = migrateSnapshot(v1) as typeof v1 & {
    shape: { legs: { fenceHeightCm: number; heightCm?: number; baseHeightCm: number }[] };
  };

  it('produces a valid current-version snapshot', () => {
    expect(migrated.v).toBe(SNAPSHOT_VERSION);
    expect(isValidSnapshot(migrated)).toBe(true);
  });

  it('keeps every leg filling exactly the same board-stack height as before', () => {
    migrated.shape.legs.forEach((leg, i) => {
      const old = v1.shape.legs[i];
      expect(leg.heightCm).toBeUndefined();
      expect(legFillHeightCm(leg as never)).toBe(old.heightCm - old.baseHeightCm);
    });
  });

  it('makes field-scoped rule anchors relative to their own leg’s wall top', () => {
    expect(migrated.colorScheme.boardRules.map((r) => r.anchorHeightCm)).toEqual([30, 30]);
    expect(migrated.profileScheme.spacerRules[0].anchorHeightCm).toBe(20);
  });

  it('leaves a current snapshot untouched', () => {
    expect(migrateSnapshot(migrated)).toBe(migrated);
  });
});
