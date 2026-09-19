import type { Shape } from '../geometry/shape';
import { fieldCountForLeg } from '../geometry/shape';
import { computeBoardStack } from '../geometry/field';
import type { ColorScheme, ProfileScheme } from '../scene/Scene';
import { resolveBoardStepCandidates } from '../scene/Scene';

/** A rule whose nearest step (by absolute height from the ground) is farther than this is dropped — its board no longer exists in any meaningful sense. Tunable product call, not a client dimension. */
export const HEIGHT_MAP_TOLERANCE_CM = 10;

/** Re-mapping can shift indices, which changes the stack, which can shift indices again. Converges in 1-2 rounds in practice; 3 is a hard stop against pathological catalogs. */
const MAX_ROUNDS = 3;

type FieldKey = string;
const keyOf = (legIndex: number, fieldIndex: number): FieldKey => `${legIndex}:${fieldIndex}`;

interface AnchoredRule {
  stepIndex: number;
  anchorHeightCm: number;
  direction: 'exact' | 'below' | 'above';
  scope: 'field' | 'global';
  legIndex?: number;
  fieldIndex?: number;
}

/**
 * Absolute height (cm from the ground) of every step in every field, as the
 * stack currently resolves. This is the map that turns a rule's anchor —
 * its stable identity — back into a stepIndex, which is the only thing
 * resolution itself ever matches on.
 */
function buildHeightMap(shape: Shape, profileScheme: ProfileScheme): Map<FieldKey, number[]> {
  const map = new Map<FieldKey, number[]>();
  shape.legs.forEach((leg, legIndex) => {
    const startIsMiddle = legIndex > 0 && shape.junctions[legIndex - 1]?.type !== 'disconnect';
    const endIsMiddle = legIndex < shape.legs.length - 1 && shape.junctions[legIndex]?.type !== 'disconnect';
    const fieldCount = fieldCountForLeg(leg.lengthM, startIsMiddle, endIsMiddle);
    const fillHeightCm = leg.heightCm - leg.baseHeightCm;
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
      const stack = computeBoardStack(fillHeightCm, (stepIndex) =>
        resolveBoardStepCandidates(profileScheme, legIndex, fieldIndex, stepIndex, leg.modelId, leg.sizeId),
      );
      map.set(keyOf(legIndex, fieldIndex), stack.boards.map((b) => leg.baseHeightCm + b.centerCm));
    }
  });
  return map;
}

/** Nearest step index by absolute height, or null when nothing is within tolerance. */
function nearestStep(heights: number[], anchorHeightCm: number): number | null {
  let best: number | null = null;
  let bestDelta = Infinity;
  for (let i = 0; i < heights.length; i++) {
    const delta = Math.abs(heights[i] - anchorHeightCm);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best !== null && bestDelta <= HEIGHT_MAP_TOLERANCE_CM ? best : null;
}

/**
 * Re-points one rule array against the current stacks. A rule whose field
 * no longer exists, or whose anchor has no step within tolerance, is
 * DROPPED — that deletion is the whole point: a rule parked on an index
 * that doesn't currently exist is exactly what made the fence "remember"
 * a colour after the height went down and came back up.
 *
 * Global-scoped rules are left alone; they were never tied to one field's
 * geometry. (Nothing writes them anymore, but old state may still hold some.)
 */
function remapRules<T extends AnchoredRule>(rules: T[], heightMap: Map<FieldKey, number[]>): T[] {
  const out: T[] = [];
  for (const rule of rules) {
    if (rule.scope !== 'field' || rule.legIndex === undefined || rule.fieldIndex === undefined) {
      out.push(rule);
      continue;
    }
    const heights = heightMap.get(keyOf(rule.legIndex, rule.fieldIndex));
    if (!heights || heights.length === 0) continue;
    const stepIndex = nearestStep(heights, rule.anchorHeightCm);
    if (stepIndex === null) continue;
    out.push(stepIndex === rule.stepIndex ? rule : { ...rule, stepIndex });
  }
  return dedupe(out);
}

/**
 * One rule per (field, step, direction). Later wins, matching the
 * resolvers' own "last rule wins" order — so this only ever removes rules
 * that were already invisible. Without it, every height change that maps
 * two anchors onto the same step leaves a permanent duplicate, and the
 * arrays grow without bound (they're scanned per board, per rebuild).
 */
function dedupe<T extends AnchoredRule>(rules: T[]): T[] {
  const lastAt = new Map<string, number>();
  rules.forEach((r, i) => {
    lastAt.set(`${r.legIndex}:${r.fieldIndex}:${r.stepIndex}:${r.direction}:${r.scope}`, i);
  });
  return rules.filter((r, i) => lastAt.get(`${r.legIndex}:${r.fieldIndex}:${r.stepIndex}:${r.direction}:${r.scope}`) === i);
}

/**
 * Pure and idempotent: running it twice on the same input returns the same
 * output, because every stepIndex is derived fresh from anchorHeightCm
 * rather than from the previous result. That's what makes it safe to call
 * on every geometry edit — including per tick of a slider drag — without
 * accumulating drift.
 *
 * Returns the SAME object references when nothing changed, so callers can
 * skip a state update entirely and avoid a spurious history entry.
 */
export function reconcileRules(
  shape: Shape,
  colorScheme: ColorScheme,
  profileScheme: ProfileScheme,
): { colorScheme: ColorScheme; profileScheme: ProfileScheme } {
  let color = colorScheme;
  let profile = profileScheme;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const heightMap = buildHeightMap(shape, profile);
    const boardRules = remapRules(color.boardRules, heightMap);
    const rules = remapRules(profile.rules, heightMap);
    const spacerRules = remapRules(profile.spacerRules, heightMap);

    const colorSame = sameRules(boardRules, color.boardRules);
    const profileSame = sameRules(rules, profile.rules) && sameRules(spacerRules, profile.spacerRules);
    if (colorSame && profileSame) break;

    if (!colorSame) color = { ...color, boardRules };
    if (!profileSame) profile = { ...profile, rules, spacerRules };
  }

  return { colorScheme: color, profileScheme: profile };
}

function sameRules<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}