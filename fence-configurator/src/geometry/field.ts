import { ROSETTE_OFFSET_CM } from './constants';
import { resolveClosure, cents } from './closure';

/** Resolved dims for ONE board — modelId/sizeId travel with it so the caller can react (styling, selection) without a second lookup. */
export interface ResolvedBoardDims {
  modelId: string;
  sizeId: string;
  boardHeightCm: number;
  /** Already multiplied — what actually gets placed. */
  spacerHeightCm: number;
  /** Unmultiplied catalog spacer. */
  baseSpacerHeightCm?: number;
  /** The multiplier baked into spacerHeightCm. */
  spacerMultiplier?: number;
  /** True when the user set this step's profile or spacer themselves. An
   * explicit step is placed even when it doesn't fit (it then overflows,
   * see BoardStack.overflowCm) and the closure never replaces it. */
  explicit?: boolean;
}

export interface StackedBoard {
  /** Vertical center offset (cm, from post base) — feeds mesh placement. */
  centerCm: number;
  /** Bottom-up stacking order (0 = bottom). What profile rules key on — the walk's own loop counter, known before the board's type is. */
  stepIndex: number;
  boardHeightCm: number;
  /** Spacer BELOW this board. */
  spacerBelowCm: number;
  /** Multiplier behind spacerBelowCm (×0/×1/×2). */
  spacerMultiplier: number;
  modelId: string;
  sizeId: string;
  /** Chosen by the closing algorithm rather than by packing. At most one per column — always the top board. */
  closure?: true;
  /** A user-set top step that pokes above the fill height. */
  overflow?: true;
}

export interface BoardStack {
  boards: StackedBoard[];
  /** Top of the topmost board (cm, from post base). Never above the fill height unless overflowCm > 0. */
  filledHeightCm: number;
  /** How far (cm) a user-set top step reaches past the fill height. 0 when nothing overflows. */
  overflowCm: number;
}

/**
 * Two phases.
 *
 * PHASE 1 packs boards step by step from the rosette up, each step
 * resolved independently (the leg's own profile, or a per-step rule), for
 * as long as they fit. If the step that doesn't fit is one the user set
 * explicitly, it's placed anyway and flagged as overflowing — the user's
 * choice is never silently replaced. The UI marks it and offers to raise
 * the fence to fit it.
 *
 * PHASE 2 closes the remainder with ONE final step chosen by
 * resolveClosure — any catalog profile, any catalog spacer — either on top
 * of the packed stack or in place of its last step. Nothing below that
 * final step is ever re-spaced. When no exact close exists (e.g. a
 * fractional fill height against whole-cm parts), the closest fit that
 * doesn't exceed the fill height wins, leaving the smallest possible gap
 * under the cap.
 */
export function computeBoardStack(
  totalHeightCm: number,
  resolveDims: (stepIndex: number) => ResolvedBoardDims[],
): BoardStack {
  const ceiling = cents(totalHeightCm);
  const boards: StackedBoard[] = [];
  const explicitAt: boolean[] = [];
  let cursor = cents(ROSETTE_OFFSET_CM);

  function place(dims: ResolvedBoardDims, extra: Partial<StackedBoard> = {}) {
    const spacer = cents(dims.spacerHeightCm);
    const board = cents(dims.boardHeightCm);
    boards.push({
      centerCm: (cursor + spacer + board / 2) / 100,
      stepIndex: boards.length,
      boardHeightCm: dims.boardHeightCm,
      spacerBelowCm: dims.spacerHeightCm,
      spacerMultiplier: dims.spacerMultiplier ?? 1,
      modelId: dims.modelId,
      sizeId: dims.sizeId,
      ...extra,
    });
    explicitAt.push(!!dims.explicit);
    cursor += spacer + board;
  }

  const result = (overflow = 0): BoardStack => ({ boards, filledHeightCm: cursor / 100, overflowCm: overflow / 100 });

  if (cursor >= ceiling) return result();

  // --- Phase 1: pack ---
  let next: ResolvedBoardDims | undefined;
  for (let stepIndex = 0; ; stepIndex++) {
    next = resolveDims(stepIndex)[0];
    if (!next) return result();
    const step = cents(next.spacerHeightCm + next.boardHeightCm);
    if (cursor + step <= ceiling) {
      place(next);
      continue;
    }
    if (next.explicit) {
      place(next, { overflow: true });
      return result(cursor - ceiling);
    }
    break;
  }

  // --- Phase 2: close with one final step ---
  const remaining = ceiling - cursor;
  if (remaining <= 0) return result();

  const last = boards.at(-1);
  const lastReplaceable = boards.length > 1 && !explicitAt[boards.length - 1];
  const column = boards[0] ?? next;
  const plan = resolveClosure({
    remainingCm: remaining / 100,
    replaceableStepCm: lastReplaceable && last ? last.spacerBelowCm + last.boardHeightCm : null,
    columnModelId: column.modelId,
    columnSizeId: column.sizeId,
    // Step 0's bottom gap belongs to the user (default ×0), never to the closure.
    appendSpacerMultiplier: boards.length === 0 ? next.spacerMultiplier ?? 0 : undefined,
  });
  if (!plan) return result();

  if (plan.mode === 'replace') {
    const removed = boards.pop()!;
    explicitAt.pop();
    cursor -= cents(removed.spacerBelowCm + removed.boardHeightCm);
  }
  place(plan.dims, { closure: true });
  return result();
}
