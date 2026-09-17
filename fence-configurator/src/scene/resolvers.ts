import { resolveBoardDims, FENCE_CATALOG } from '../geometry/catalog';
import type { ResolvedBoardDims } from '../geometry/field';
import type { ColorScheme, ProfileScheme } from './types';
import { SPACER_OPTIONS } from './spacerOptions';

/** Pure — used by both the scene (to color meshes) and the panel (to seed the color picker with a board's current color on click). Step-indexed now, same as resolveBoardProfile — see BoardColorRule's doc comment in types.ts for why. */
export function resolveBoardColorHex(
  colorScheme: ColorScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
): string {
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
  let multiplier = 1;
  for (const rule of profileScheme.spacerRules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = rule.stepIndex === stepIndex;
    else if (rule.direction === 'below') matches = stepIndex <= rule.stepIndex;
    else matches = stepIndex >= rule.stepIndex;
    if (matches) multiplier = rule.multiplier;
  }
  return multiplier;
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
): { modelId: string; sizeId: string; fromRule: boolean } {
  let modelId = fallbackModelId;
  let sizeId = fallbackSizeId;
  let fromRule = false;
  for (const rule of profileScheme.rules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = rule.stepIndex === stepIndex;
    else if (rule.direction === 'below') matches = stepIndex <= rule.stepIndex;
    else matches = stepIndex >= rule.stepIndex;
    if (matches) {
      modelId = rule.modelId;
      sizeId = rule.sizeId;
      fromRule = true;
    }
  }
  return { modelId, sizeId, fromRule };
}

/**
 * Builds the ordered candidate list computeBoardStack tries for one step.
 * An explicit profile rule is absolute — a single candidate, no fallback,
 * respecting a deliberate manual choice even on the rare step where it
 * doesn't fit. The leg's own passive default is always tried first; when
 * no rule matches AND the default doesn't fit the remaining room, every
 * OTHER model/size in the whole catalog is offered as a fallback too —
 * confirmed: mixing models/profile types for just that last step is fine,
 * closing flush matters more than staying single-profile. Fallbacks are
 * sorted by their own (board + spacer) step size, largest first, so
 * computeBoardStack's "take the first that fits" naturally picks whichever
 * one gets closest to the ceiling without going over — recomputed fresh
 * every render from current geometry, so it never goes stale: moving
 * baseHeightCm again always re-solves for whatever profile now fits best,
 * rather than leaving behind a leftover gap from a stale earlier choice.
 */
export function resolveBoardStepCandidates(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
  fallbackModelId: string,
  fallbackSizeId: string,
): ResolvedBoardDims[] {
  const { modelId, sizeId, fromRule } = resolveBoardProfile(
    profileScheme,
    legIndex,
    fieldIndex,
    stepIndex,
    fallbackModelId,
    fallbackSizeId,
  );
  const spacerMultiplier = resolveSpacerMultiplier(profileScheme, legIndex, fieldIndex, stepIndex);
  const primaryDims = resolveBoardDims(modelId, sizeId);
  const primary: ResolvedBoardDims = {
    modelId,
    sizeId,
    boardHeightCm: primaryDims.boardHeightCm,
    spacerHeightCm: primaryDims.spacerHeightCm * spacerMultiplier,
  };

  if (fromRule) return [primary];

  // Fallback candidates now cross EVERY catalog model/size with EVERY
  // valid spacer multiplier (SPACER_OPTIONS) — not just the currently
  // resolved spacer value — so a gap that only closes with, say, a zero
  // spacer on a specific model/size combination is still found. Same
  // "closest fit without exceeding, no cutting" philosophy already used
  // for base-height matching, just extended along the spacer dimension
  // too. Confirmed with the client: some real installs close a field
  // with a zero-spacer step.
  //
  // Note: this can now try a DIFFERENT spacer than an explicit spacer
  // rule at this step, if that rule's own value doesn't fit — there's no
  // "fromRule" guard for spacer the way there is for profile above. If
  // you want an explicit spacer choice protected from being overridden
  // here too, that needs a small follow-up (threading a similar fromRule
  // signal out of resolveSpacerMultiplier).
  const alternates: ResolvedBoardDims[] = FENCE_CATALOG.flatMap((model) =>
    model.sizes.flatMap((size) =>
      SPACER_OPTIONS.filter(
        (opt) => !(model.id === modelId && size.id === sizeId && opt.value === spacerMultiplier),
      ).map((opt) => ({
        modelId: model.id,
        sizeId: size.id,
        boardHeightCm: size.boardHeightCm,
        spacerHeightCm: size.spacerHeightCm * opt.value,
      })),
    ),
  ).sort((a, b) => b.boardHeightCm + b.spacerHeightCm - (a.boardHeightCm + a.spacerHeightCm));

  return [primary, ...alternates];
}
