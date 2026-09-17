import { describe, it, expect } from 'vitest';
import { resolveBoardDims, sizesForModel, FENCE_CATALOG } from './catalog';
import golden from './__fixtures__/golden.json';

/** See shape.test.ts's header comment — same golden-baseline policy applies here. */

describe('resolveBoardDims / sizesForModel — golden baseline', () => {
  it('known model + known size -> that size\'s exact dims', () => {
    expect(resolveBoardDims('type-2', 'size-2')).toEqual(golden.catalog.known);
  });
  it('unknown model -> falls back to the FIRST catalog model + its first size', () => {
    expect(resolveBoardDims('nope', 'nope')).toEqual(golden.catalog.unknownModel_fallsBackToFirst);
  });
  it('known model, unknown size -> falls back to that model\'s FIRST size', () => {
    expect(resolveBoardDims('type-2', 'nope')).toEqual(golden.catalog.unknownSizeKnownModel_fallsBackToFirstSize);
  });
  it('sizesForModel on a known model returns all its sizes, in catalog order', () => {
    expect(sizesForModel('type-2')).toEqual(golden.catalog.sizesForKnownModel);
  });
  it('sizesForModel on an unknown model returns an empty array, never throws', () => {
    expect(sizesForModel('nope')).toEqual(golden.catalog.sizesForUnknownModel);
  });
  it('catalog currently has the expected number of models', () => {
    expect(FENCE_CATALOG.length).toBe(golden.catalog.catalogLength);
  });
});

describe('catalog — invariants', () => {
  it('every model has at least one size', () => {
    for (const model of FENCE_CATALOG) expect(model.sizes.length).toBeGreaterThan(0);
  });
  it('resolveBoardDims never throws, even with garbage ids', () => {
    expect(() => resolveBoardDims('', '')).not.toThrow();
  });
});
