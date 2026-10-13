import type { Shape } from '../geometry/shape';
import { fieldCountForLeg } from '../geometry/shape';
import type { ColorScheme, ProfileScheme } from '../scene/Scene';
import { fieldBoardStack } from '../scene/fieldStack';

/** A rule whose nearest step (by height from its leg's fence base) is farther than this is dropped — its board no longer exists in any meaningful sense. Tunable product call, not a client dimension. */
export const HEIGHT_MAP_TOLERANCE_CM = 10;

/** Re-mapping can shift indices, which changes the stack, which can shift indices again. Converges in 1-2 rounds in practice; 3 is a hard stop against pathological catalogs. */
const MAX_ROUNDS = 3;

type FieldKey = string;

interface FieldHeights {
  /** Center of every step, from the leg's fence base. */
  centers: number[];
  /** This leg's fence height changed in the edit being reconciled. */
  resized: boolean;
  /** Per step: rebuilt by the closing algorithm rather than packed. */
  closure: boolean[];
}
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
 * Height of every step in every field, measured from its leg's own fence
 * base (top of the wall) — NOT from the ground — as the stack currently
 * resolves. Relative on purpose: raising/lowering a wall moves the whole
 * fence as one unit, so its rules must not notice. This is the map that turns a rule's anchor —
 * its stable identity — back into a stepIndex, which is the only thing
 * resolution itself ever matches on.
 */
function buildHeightMap(
  shape: Shape,
  profileScheme: ProfileScheme,
  resizedLegs: ReadonlySet<number>,
): Map<FieldKey, FieldHeights> {
  const map = new Map<FieldKey, FieldHeights>();
  shape.legs.forEach((leg, legIndex) => {
    const startIsMiddle = legIndex > 0 && shape.junctions[legIndex - 1]?.type !== 'disconnect';
    const endIsMiddle = legIndex < shape.legs.length - 1 && shape.junctions[legIndex]?.type !== 'disconnect';
    const fieldCount = fieldCountForLeg(leg.lengthM, startIsMiddle, endIsMiddle);
    const resized = resizedLegs.has(legIndex);
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
      const stack = fieldBoardStack(profileScheme, leg, legIndex, fieldIndex);
      // On a leg whose fence height just changed, a step that only exists
      // by overflowing the new top doesn't count as surviving: an overflow
      // is something the user picks directly, never a side effect of
      // resizing.
      const boards = resized ? stack.boards.filter((b) => !b.overflow) : stack.boards;
      map.set(keyOf(legIndex, fieldIndex), {
        centers: boards.map((b) => b.centerCm),
        resized,
        closure: boards.map((b) => !!b.closure),
      });
    }
  });
  return map;
}

/** Nearest step index by fence-relative height, or null when nothing is within tolerance. */
function nearestStep(heights: number[], anchorHeightCm: number, toleranceCm: number): number | null {
  let best: number | null = null;
  let bestDelta = Infinity;
  for (let i = 0; i < heights.length; i++) {
    const delta = Math.abs(heights[i] - anchorHeightCm);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best !== null && bestDelta <= toleranceCm ? best : null;
}

/**
 * Re-points one rule array against the current stacks. A rule whose field
 * no longer exists, or whose anchor has no step within tolerance, is
 * DROPPED — that deletion is the whole point: a rule parked on an index
 * that doesn't currently exist is exactly what made the fence "remember"
 * a colour after the height went down and came back up.
 *
 * On a leg whose fence height just changed, it's stricter, and keyed on
 * the step itself rather than on height: a height change never moves or
 * renumbers the packed steps below the top, so a rule survives only if
 * its own step index is still a packed step. A step the new height
 * removed, pushed into overflow, or that the closure rebuilt takes its
 * rules with it — raising the fence again recreates that step clean. (The
 * 10cm height tolerance used to slide such rules onto the step below.)
 * Survivors get their anchor refreshed to where the step now stands.
 * One exception: a 'below' sweep from a removed step keeps colouring what
 * is left, re-anchored to the new top step so it doesn't grow back when
 * the fence is raised again.
 *
 * Global-scoped rules are left alone; they were never tied to one field's
 * geometry. (Nothing writes them anymore, but old state may still hold some.)
 */
function remapRules<T extends AnchoredRule>(rules: T[], heightMap: Map<FieldKey, FieldHeights>): T[] {
  const out: T[] = [];
  for (const rule of rules) {
    if (rule.scope !== 'field' || rule.legIndex === undefined || rule.fieldIndex === undefined) {
      out.push(rule);
      continue;
    }
    const field = heightMap.get(keyOf(rule.legIndex, rule.fieldIndex));
    if (!field || field.centers.length === 0) continue;

    if (field.resized) {
      const i = rule.stepIndex;
      if (i < field.centers.length && !field.closure[i]) {
        out.push(rule.anchorHeightCm === field.centers[i] ? rule : { ...rule, anchorHeightCm: field.centers[i] });
      } else if (rule.direction === 'below') {
        // Re-anchor to the highest step this sweep still legitimately covers.
        let top = Math.min(i, field.centers.length) - 1;
        while (top >= 0 && field.closure[top]) top--;
        if (top >= 0) out.push({ ...rule, stepIndex: top, anchorHeightCm: field.centers[top] });
      }
      continue;
    }

    const stepIndex = nearestStep(field.centers, rule.anchorHeightCm, HEIGHT_MAP_TOLERANCE_CM);
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
  /** Legs whose fence height changed in this edit — see remapRules. */
  resizedLegs: ReadonlySet<number> = new Set(),
): { colorScheme: ColorScheme; profileScheme: ProfileScheme } {
  let color = colorScheme;
  let profile = profileScheme;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round === MAX_ROUNDS - 1) console.warn('reconcile did NOT converge');
    const heightMap = buildHeightMap(shape, profile, resizedLegs);
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

