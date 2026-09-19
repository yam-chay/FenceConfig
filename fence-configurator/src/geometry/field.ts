import { ROSETTE_OFFSET_CM } from './constants';
import { resolveClosure, type SpacerBumpCapacity } from './closure';

/** Resolved dims for ONE board — modelId/sizeId travel with it so the caller can react (styling, selection) without a second lookup. */
export interface ResolvedBoardDims {
  modelId: string;
  sizeId: string;
  boardHeightCm: number;
  /** Already multiplied — what actually gets placed. */
  spacerHeightCm: number;
  /** Unmultiplied catalog spacer. Tells closure what one ×1→×2 widening is worth. */
  baseSpacerHeightCm?: number;
  /** The multiplier baked into spacerHeightCm. Closure only widens steps still at the ×1 default. */
  spacerMultiplier?: number;
}

export interface StackedBoard {
  /** Vertical center offset (cm, from post base) — feeds mesh placement. */
  centerCm: number;
  /** Bottom-up stacking order (0 = bottom). What profile rules key on — the walk's own loop counter, known before the board's type is. */
  stepIndex: number;
  boardHeightCm: number;
  /** Spacer BELOW this board. 0 for the first — nothing under it to space from. */
  spacerBelowCm: number;
  modelId: string;
  sizeId: string;
}

export interface BoardStack {
  boards: StackedBoard[];
  /** Height actually filled. Falls short of the closing height only when nothing in the catalog closes the remainder exactly. */
  filledHeightCm: number;
}

/**
 * Two phases.
 *
 * PHASE 1 packs as many PRIMARY boards as fit — the leg's own model/size,
 * or an explicit per-step rule. No substitution at all here, so the body
 * of the column is always one deliberate profile.
 *
 * PHASE 2 hands whatever is left to resolveClosure, which searches every
 * catalog combination for a plan that closes it EXACTLY, preferring
 * widened spacers over an extra board and the column's own model over a
 * foreign one. The old code instead took the largest candidate that fit at
 * each step and never reconsidered — which is why the top board changed
 * model every 1-2 cm of slider travel and sibling fields could disagree.
 *
 * When no exact plan exists the remainder is left exposed rather than
 * approximated: under ~1 cm the cap covers it, and an even top line across
 * the fence matters more than the last few millimetres.
 */
export function computeBoardStack(
  totalHeightCm: number,
  resolveDims: (stepIndex: number) => ResolvedBoardDims[],
): BoardStack {
  const ceilingCm = totalHeightCm;
  const boards: StackedBoard[] = [];
  /** Parallel to `boards` — closure bookkeeping, deliberately kept out of the public StackedBoard shape. */
  const spacerInfo: { base: number; multiplier: number }[] = [];
  let cursor = ROSETTE_OFFSET_CM;

  function place(dims: ResolvedBoardDims) {
    const spacer = dims.spacerHeightCm;
    boards.push({
      centerCm: cursor + spacer + dims.boardHeightCm / 2,
      stepIndex: boards.length,
      boardHeightCm: dims.boardHeightCm,
      spacerBelowCm: spacer,
      modelId: dims.modelId,
      sizeId: dims.sizeId,
    });
    spacerInfo.push({
      base: dims.baseSpacerHeightCm ?? dims.spacerHeightCm,
      multiplier: dims.spacerMultiplier ?? 1,
    });
    cursor += spacer + dims.boardHeightCm;
  }

  /** Re-derives every center from the bottom after spacers change. */
  function reflow() {
    let c = ROSETTE_OFFSET_CM;
    for (const b of boards) {
      c += b.spacerBelowCm;
      b.centerCm = c + b.boardHeightCm / 2;
      c += b.boardHeightCm;
    }
    cursor = c;
  }

  // --- Phase 1: primaries only ---
  for (let stepIndex = 0; ; stepIndex++) {
    const primary = resolveDims(stepIndex)[0];
    if (!primary) break;
    if (cursor + primary.spacerHeightCm + primary.boardHeightCm > ceilingCm) break;
    place(primary);
  }

  // --- Phase 2: close the remainder ---
  const remainingCm = ceilingCm - cursor;
  if (remainingCm > 0 && boards.length > 0) {
    // Step 0's gap sits against the rosette and is never touched here; a
    // step the user set explicitly (multiplier ≠ 1) is left alone too.
    const capacityBySize = new Map<number, number>();
    for (let i = 1; i < boards.length; i++) {
      const info = spacerInfo[i];
      if (info.multiplier !== 1 || info.base <= 0) continue;
      capacityBySize.set(info.base, (capacityBySize.get(info.base) ?? 0) + 1);
    }
    const capacity: SpacerBumpCapacity[] = [...capacityBySize].map(([addCm, available]) => ({
      addCm,
      available,
    }));

    const top = boards[boards.length - 1];
    const plan = resolveClosure(remainingCm, capacity, top.modelId, top.sizeId);

    if (plan) {
      // Widen from the top down: a wider gap just under the cap reads as
      // part of the cap detail, where the eye is least likely to measure it.
      for (const bump of plan.bumps) {
        let left = bump.count;
        for (let i = boards.length - 1; i >= 1 && left > 0; i--) {
          const info = spacerInfo[i];
          if (info.multiplier !== 1 || info.base !== bump.addCm) continue;
          boards[i].spacerBelowCm += bump.addCm;
          info.multiplier = 2;
          left--;
        }
      }
      reflow();
      for (const dims of plan.boards) place(dims);
    }
  }

  return { boards, filledHeightCm: cursor };
}