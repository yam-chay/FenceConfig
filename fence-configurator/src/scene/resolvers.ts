import { resolveBoardDims } from '../geometry/catalog';
import type { ResolvedBoardDims } from '../geometry/field';
import type { BakedStep, ColorScheme, ProfileScheme } from './types';

const fieldKey = (legIndex: number, fieldIndex: number) => `${legIndex}:${fieldIndex}`;

/** The baked step at this position, or null when the design isn't baked (or the field has no such step). */
function bakedStep(profileScheme: ProfileScheme, legIndex: number, fieldIndex: number, stepIndex: number): BakedStep | null {
  return profileScheme.baked?.[fieldKey(legIndex, fieldIndex)]?.[stepIndex] ?? null;
}

/** Pure — used by both the scene (to color meshes) and the panel (to seed the color picker with a board's current color on click). Step-indexed now, same as resolveBoardProfile — see BoardColorRule's doc comment in types.ts for why. */
export function resolveBoardColorHex(
  colorScheme: ColorScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
): string {
  if (colorScheme.baked) return colorScheme.baked[fieldKey(legIndex, fieldIndex)]?.[stepIndex] ?? colorScheme.baseBoardColorHex;
  let color = colorScheme.baseBoardColorHex;
  for (const rule of colorScheme.boardRules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = rule.stepIndex === stepIndex;
    else if (rule.direction === 'below') matches = stepIndex <= rule.stepIndex;
    else matches = stepIndex >= rule.stepIndex;
    if (matches) color = rule.colorHex;
  }
  return color;
}

/** Pure — resolves the spacer multiplier for one step, default ×1. Later rules win, same as everything else. */
export function resolveSpacerMultiplier(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
): number {
  return resolveSpacer(profileScheme, legIndex, fieldIndex, stepIndex).multiplier;
}

/** resolveSpacerMultiplier plus whether the winning rule was the user's own click on THIS step (an 'exact', non-derived rule). */
export function resolveSpacer(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
): { multiplier: number; explicit: boolean } {
  // A baked step is the user's final column as it was — explicit, so the
  // stack places it exactly where it stood, overflow included.
  if (profileScheme.baked) {
    const step = bakedStep(profileScheme, legIndex, fieldIndex, stepIndex);
    return step ? { multiplier: step.spacerMultiplier, explicit: true } : { multiplier: stepIndex === 0 ? 0 : 1, explicit: false };
  }
  // Step 0 has no spacer below it by DEFAULT — but that's a default, not
  // a law of the geometry: the user can raise it, and restore-default
  // brings it back to 0. Moved here out of computeBoardStack, where it
  // was hardcoded and no rule could ever override it.
  let multiplier = stepIndex === 0 ? 0 : 1;
  let explicit = false;
  for (const rule of profileScheme.spacerRules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    // The bottom gap is only ever changed by targeting step 0 directly.
    // A below/above sweep anchored anywhere must not drag it along — it's
    // the seam against the rosette, not an ordinary inter-board gap.
    // (A multi-select that includes step 0 writes an 'exact' rule for it,
    // so deliberate targeting still works.)
    if (stepIndex === 0 && !(rule.direction === 'exact' && rule.stepIndex === 0)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = rule.stepIndex === stepIndex;
    else if (rule.direction === 'below') matches = stepIndex <= rule.stepIndex;
    else matches = stepIndex >= rule.stepIndex;
    if (matches) {
      multiplier = rule.multiplier;
      explicit = rule.direction === 'exact' && !rule.derived;
    }
  }
  return { multiplier, explicit };
}

/**
 * Pure — used by Scene to resolve each board's dims while stacking, and by
 * the panel to seed the type/size carousel with a clicked board's current
 * profile. `fallbackModelId`/`fallbackSizeId` are the leg's own model/size
 * (the "סוג פרופיל (לכל המקטע)" / "גודל" carousels) — a passive default a
 * rule overrides only at the step indices it targets.
 */
export function resolveBoardProfile(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
  fallbackModelId: string,
  fallbackSizeId: string,
): { modelId: string; sizeId: string; fromRule: boolean; explicit: boolean } {
  if (profileScheme.baked) {
    const step = bakedStep(profileScheme, legIndex, fieldIndex, stepIndex);
    return step
      ? { modelId: step.modelId, sizeId: step.sizeId, fromRule: true, explicit: true }
      : { modelId: fallbackModelId, sizeId: fallbackSizeId, fromRule: false, explicit: false };
  }
  let modelId = fallbackModelId;
  let sizeId = fallbackSizeId;
  let fromRule = false;
  let explicit = false;
  for (const rule of profileScheme.rules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = rule.stepIndex === stepIndex;
    else if (rule.direction === 'below') matches = stepIndex <= rule.stepIndex;
    else matches = stepIndex >= rule.stepIndex;
    if (matches) {
      modelId = rule.modelId;
      sizeId = rule.sizeId;
      // Assignment, not |= : later rules win here exactly as they do for
      // modelId/sizeId, so a propagated rule landing on top of an older
      // clicked one correctly releases the no-fallback lock too.
      fromRule = !rule.derived;
      // Only a direct pick on THIS step can push past the fence top — a
      // below/above sweep just describes the column, wherever it ends.
      explicit = fromRule && rule.direction === 'exact';
    }
  }
  return { modelId, sizeId, fromRule, explicit };
}

/**
 * What computeBoardStack places at one step: the leg's own profile, or
 * whatever a rule set for this step, with its resolved spacer. A single
 * candidate — choosing a DIFFERENT profile to close the column is the
 * closing algorithm's job (geometry/closure.ts), and only ever for the
 * top step. `explicit` marks a step the user picked directly, which is
 * placed even if it overflows.
 */
export function resolveBoardStepCandidates(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
  fallbackModelId: string,
  fallbackSizeId: string,
): ResolvedBoardDims[] {
  // Baked: the column ends where the baked steps end. An empty list stops
  // computeBoardStack before its closing phase, so nothing is packed or
  // closed on top of what was saved.
  if (profileScheme.baked && !bakedStep(profileScheme, legIndex, fieldIndex, stepIndex)) return [];
  const profile = resolveBoardProfile(profileScheme, legIndex, fieldIndex, stepIndex, fallbackModelId, fallbackSizeId);
  const spacer = resolveSpacer(profileScheme, legIndex, fieldIndex, stepIndex);
  const dims = resolveBoardDims(profile.modelId, profile.sizeId);
  return [
    {
      modelId: profile.modelId,
      sizeId: profile.sizeId,
      boardHeightCm: dims.boardHeightCm,
      spacerHeightCm: dims.spacerHeightCm * spacer.multiplier,
      baseSpacerHeightCm: dims.spacerHeightCm,
      spacerMultiplier: spacer.multiplier,
      explicit: profile.explicit || spacer.explicit,
    },
  ];
}
