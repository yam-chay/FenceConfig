import { FENCE_CATALOG } from './catalog';
import { SPACER_OPTIONS } from './spacerOptions';
import type { ResolvedBoardDims } from './field';

/**
 * Closing a column = choosing ONE final step (board + the spacer under it)
 * that brings the stack as close as possible to the fill height without
 * ever exceeding it. Everything below that final step stays exactly as
 * packed — the closure never re-spaces boards that were already placed.
 *
 * The final step may be any catalog profile with any catalog spacer
 * (FENCE_CATALOG × SPACER_OPTIONS, generated at runtime — nothing here
 * hardcodes a dimension). It either goes ON TOP of the packed stack
 * ('append'), or takes the place of the packed stack's last step
 * ('replace') when the remainder is too small for any step to fit above —
 * which is the only way the last step's own spacer ever changes.
 *
 * Preference, in order (first difference decides):
 *   1. Smallest leftover gap under the cap — exact when possible.
 *   2. 'append' before 'replace' — the smallest closing step that works,
 *      keeping one more ordinary board.
 *   3. Normal spacer (×1), then double (×2), then zero (×0 — boards
 *      touching read as a defect, so last).
 *   4. The column's own profile, then its other sizes, then other models.
 *   5. Catalog order — only so the same input always gives the same plan.
 *
 * This ordering is a product call that will keep being tuned; it lives in
 * closingRank() and nowhere else.
 */

/** cm → integer hundredths. All comparisons run in these so no float decides whether a column closes. */
export const cents = (cm: number) => Math.round(cm * 100);

export type ClosureMode = 'append' | 'replace';

export interface ClosurePlan {
  mode: ClosureMode;
  dims: ResolvedBoardDims;
  /** Gap (cm) still left under the cap after this plan. 0 = exact. */
  leftoverCm: number;
}

let candidateCache: { dims: ResolvedBoardDims; catalogOrder: number }[] | null = null;

/** Every board+spacer combination the catalog can produce. Built once — the catalog is static within a session. */
function allCandidates() {
  if (candidateCache) return candidateCache;
  let order = 0;
  candidateCache = FENCE_CATALOG.flatMap((model) =>
    model.sizes.flatMap((size) =>
      SPACER_OPTIONS.map((opt) => ({
        catalogOrder: order++,
        dims: {
          modelId: model.id,
          sizeId: size.id,
          boardHeightCm: size.boardHeightCm,
          spacerHeightCm: size.spacerHeightCm * opt.value,
          baseSpacerHeightCm: size.spacerHeightCm,
          spacerMultiplier: opt.value,
        },
      })),
    ),
  );
  return candidateCache;
}

const SPACER_RANK: Record<number, number> = { 1: 0, 2: 1, 0: 2 };

function closingRank(
  leftover: number,
  mode: ClosureMode,
  dims: ResolvedBoardDims,
  catalogOrder: number,
  columnModelId: string,
  columnSizeId: string,
): number[] {
  const profileRank = dims.modelId === columnModelId ? (dims.sizeId === columnSizeId ? 0 : 1) : 2;
  return [
    leftover,
    mode === 'append' ? 0 : 1,
    SPACER_RANK[dims.spacerMultiplier ?? 1] ?? 3,
    profileRank,
    catalogOrder,
  ];
}

function lessThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Best closing step, or null when nothing beats leaving the remainder as is.
 *
 * - `remainingCm`: room left above the packed stack.
 * - `replaceableStepCm`: total height (spacer + board) of the packed
 *   stack's last step when the closure may take its place, else null
 *   (step 0, or a step the user set explicitly — never touched).
 * - `appendSpacerMultiplier`: forces the spacer of an appended step (only
 *   when it would be step 0, whose bottom gap is the user's call).
 */
export function resolveClosure(params: {
  remainingCm: number;
  replaceableStepCm: number | null;
  columnModelId: string;
  columnSizeId: string;
  appendSpacerMultiplier?: number;
}): ClosurePlan | null {
  const { remainingCm, replaceableStepCm, columnModelId, columnSizeId, appendSpacerMultiplier } = params;
  const remaining = cents(remainingCm);
  if (remaining <= 0) return null;

  let best: { plan: ClosurePlan; rank: number[] } | null = null;
  // Doing nothing is the baseline every plan has to beat.
  const baselineLeftover = remaining;

  const consider = (mode: ClosureMode, room: number) => {
    for (const { dims, catalogOrder } of allCandidates()) {
      if (mode === 'append' && appendSpacerMultiplier !== undefined && dims.spacerMultiplier !== appendSpacerMultiplier) continue;
      const step = cents(dims.boardHeightCm + dims.spacerHeightCm);
      if (step > room) continue;
      const leftover = room - step;
      if (leftover >= baselineLeftover) continue;
      const rank = closingRank(leftover, mode, dims, catalogOrder, columnModelId, columnSizeId);
      if (!best || lessThan(rank, best.rank)) best = { plan: { mode, dims, leftoverCm: leftover / 100 }, rank };
    }
  };

  consider('append', remaining);
  if (replaceableStepCm !== null) consider('replace', remaining + cents(replaceableStepCm));

  return best ? (best as { plan: ClosurePlan }).plan : null;
}
