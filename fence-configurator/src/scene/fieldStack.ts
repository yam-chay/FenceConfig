import type { Leg, Shape } from '../geometry/shapeTypes';
import { fieldCountForLeg } from '../geometry/fieldCalculator';
import { POST_CAP_HEIGHT_CM } from '../geometry/constants';
import { legFillHeightCm } from '../geometry/shapeLayout';
import { computeBoardStack, type BoardStack } from '../geometry/field';
import type { ProfileScheme } from './types';
import { resolveBoardStepCandidates } from './resolvers';

/**
 * The one entry point for "what's in this field's board column". Cached:
 * the column depends only on the fill height, the leg's own profile, and
 * the profile/spacer rules that reach this field — so a wall edit, a color
 * pick or a selection click (all of which rebuild the scene) reuse the
 * previous result instead of re-packing and re-closing every field.
 *
 * The returned stack is shared between callers — treat it as read-only.
 */
const cache = new Map<string, BoardStack>();
const MAX_ENTRIES = 4000;

export function fieldBoardStack(profileScheme: ProfileScheme, leg: Leg, legIndex: number, fieldIndex: number): BoardStack {
  const fillHeightCm = legFillHeightCm(leg);
  const reaches = (r: { scope: string; legIndex?: number; fieldIndex?: number }) =>
    r.scope !== 'field' || (r.legIndex === legIndex && r.fieldIndex === fieldIndex);
  // Only what resolution reads — never anchors (re-mapping identity) or the field's own indices.
  const rules = profileScheme.rules
    .filter(reaches)
    .map((r) => [r.stepIndex, r.direction, r.modelId, r.sizeId, r.derived ? 1 : 0]);
  const spacers = profileScheme.spacerRules
    .filter(reaches)
    .map((r) => [r.stepIndex, r.direction, r.multiplier, r.derived ? 1 : 0]);
  const baked = profileScheme.baked ? (profileScheme.baked[`${legIndex}:${fieldIndex}`] ?? []) : null;
  const key = JSON.stringify([Math.round(fillHeightCm * 100), leg.modelId, leg.sizeId, rules, spacers, baked]);

  let stack = cache.get(key);
  if (!stack) {
    stack = computeBoardStack(fillHeightCm, (stepIndex) =>
      resolveBoardStepCandidates(profileScheme, legIndex, fieldIndex, stepIndex, leg.modelId, leg.sizeId),
    );
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(key, stack);
  }
  return stack;
}

export interface LegStackReport {
  /** Fence height (cm, cap included) the tallest field of this leg actually reaches. Below the leg's own fenceHeightCm by the closing gap; above it when a step overflows. */
  builtFenceHeightCm: number;
  /** Largest overflow (cm) among this leg's fields. 0 when nothing pokes past the fence top. */
  overflowCm: number;
}

/** One report per leg, from the same cached stacks the scene renders. */
export function legStackReports(shape: Shape, profileScheme: ProfileScheme): LegStackReport[] {
  return shape.legs.map((leg, legIndex) => {
    const startIsMiddle = legIndex > 0 && shape.junctions[legIndex - 1]?.type !== 'disconnect';
    const endIsMiddle = legIndex < shape.legs.length - 1 && shape.junctions[legIndex]?.type !== 'disconnect';
    const fieldCount = fieldCountForLeg(leg.lengthM, startIsMiddle, endIsMiddle);
    let filled = 0;
    let overflow = 0;
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
      const stack = fieldBoardStack(profileScheme, leg, legIndex, fieldIndex);
      filled = Math.max(filled, stack.filledHeightCm);
      overflow = Math.max(overflow, stack.overflowCm);
    }
    return {
      builtFenceHeightCm: Math.round((filled + POST_CAP_HEIGHT_CM) * 100) / 100,
      overflowCm: overflow,
    };
  });
}
