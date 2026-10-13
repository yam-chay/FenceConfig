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
