import { describe, it, expect } from 'vitest';
import { reconcileRules } from './reconcileRules';
import { defaultShape, defaultColorScheme, defaultProfileScheme } from './defaults';
import type { ColorScheme } from '../scene/Scene';

describe('reconcileRules — wall edits move the fence as one unit', () => {
  it('raising a leg’s wall keeps every rule exactly as it was', () => {
    const shape = defaultShape();
    const color: ColorScheme = {
      ...defaultColorScheme(),
      boardRules: [
        { stepIndex: 5, anchorHeightCm: 46, colorHex: '#ffffff', direction: 'exact', scope: 'field', legIndex: 0, fieldIndex: 0 },
      ],
    };
    const profile = defaultProfileScheme();
    // Settle once, then raise the wall well past the 10cm re-map tolerance.
    const settled = reconcileRules(shape, color, profile);
    const raised = { ...shape, legs: shape.legs.map((l) => ({ ...l, baseHeightCm: l.baseHeightCm + 60 })) };
    const after = reconcileRules(raised, settled.colorScheme, settled.profileScheme);
    expect(after.colorScheme).toBe(settled.colorScheme);
    expect(after.profileScheme).toBe(settled.profileScheme);
    expect(after.colorScheme.boardRules).toHaveLength(1);
  });
});

describe('reconcileRules — a step the fence height removes takes its rules with it', () => {
  // Default leg: fill 113 → steps 0..13, step 13 centred at 109.5.
  const rule = { stepIndex: 13, anchorHeightCm: 109.5, direction: 'exact' as const, scope: 'field' as const, legIndex: 0, fieldIndex: 0 };
  const withHeight = (fenceHeightCm: number) => {
    const shape = defaultShape();
    return { ...shape, legs: shape.legs.map((l) => ({ ...l, fenceHeightCm })) };
  };
  const color: ColorScheme = { ...defaultColorScheme(), boardRules: [{ ...rule, colorHex: '#ffffff' }] };
  const profile = { ...defaultProfileScheme(), spacerRules: [{ ...rule, multiplier: 2 }] };

  it('lowering past the step drops its rules instead of sliding them onto the step below', () => {
    const raised = reconcileRules(withHeight(114.4), color, profile, new Set([0]));
    expect(raised.profileScheme.spacerRules).toHaveLength(1);
    const lowered = reconcileRules(withHeight(105.4), raised.colorScheme, raised.profileScheme, new Set([0]));
    expect(lowered.colorScheme.boardRules).toHaveLength(0);
    expect(lowered.profileScheme.spacerRules).toHaveLength(0);
    // Raising again recreates step 13 clean.
    const again = reconcileRules(withHeight(114.4), lowered.colorScheme, lowered.profileScheme, new Set([0]));
    expect(again.colorScheme.boardRules).toHaveLength(0);
    expect(again.profileScheme.spacerRules).toHaveLength(0);
  });

  it('a height change that only makes a user-set top step overflow drops it too', () => {
    const lowered = reconcileRules(withHeight(112.4), color, profile, new Set([0]));
    expect(lowered.profileScheme.spacerRules).toHaveLength(0);
    expect(lowered.colorScheme.boardRules).toHaveLength(0);
  });

  it('a "below" sweep from a removed step keeps colouring what is left, re-anchored to the new top', () => {
    const below: ColorScheme = { ...defaultColorScheme(), boardRules: [{ ...rule, direction: 'below', colorHex: '#ffffff' }] };
    const lowered = reconcileRules(withHeight(105.4), below, defaultProfileScheme(), new Set([0]));
    expect(lowered.colorScheme.boardRules).toEqual([{ ...rule, direction: 'below', colorHex: '#ffffff', stepIndex: 12, anchorHeightCm: 101.5 }]);
    const again = reconcileRules(withHeight(114.4), lowered.colorScheme, defaultProfileScheme(), new Set([0]));
    expect(again.colorScheme.boardRules[0].stepIndex).toBe(12);
  });

  it('a leg whose height did not change keeps a user-set overflowing step', () => {
    const shape = withHeight(113.4);
    const after = reconcileRules(shape, color, profile);
    expect(after.profileScheme.spacerRules).toHaveLength(1);
  });
});
