import { ROSETTE_OFFSET_CM, END_MARGIN_CM } from './constants';

/** Resolved dims for ONE board — modelId/sizeId travel with it so the caller can react (styling, selection) without a second lookup. */
export interface ResolvedBoardDims {
  modelId: string;
  sizeId: string;
  boardHeightCm: number;
  spacerHeightCm: number;
}

export interface StackedBoard {
  /** Vertical center offset (cm, from post base) — feeds mesh placement. */
  centerCm: number;
  /** Position in the bottom-up stacking order (0 = bottom board). This is what profile rules key on: it's just the walk's loop counter, trivially known BEFORE the board's own type is resolved — unlike any height-based key, which depends on the board's own (not-yet-known) type and caused rules to silently miss. */
  stepIndex: number;
  boardHeightCm: number;
  /** Spacer BELOW this board, i.e. between it and the previous board. 0 for the first board — there's nothing under it to space from. */
  spacerBelowCm: number;
  modelId: string;
  sizeId: string;
}

export interface BoardStack {
  boards: StackedBoard[];
  /** The actual filled height achieved (may be slightly less than requested — boards are a fixed size, never cut). */
  filledHeightCm: number;
}

/**
 * Walks bottom-up from the rosette offset, resolving EACH board's type via
 * `resolveDims` before placing it, and stops as soon as the next board
 * wouldn't fit under END_MARGIN_CM. For a resolver that always returns the
 * same dims, this reproduces the original single-type floor behavior
 * exactly (boards never cut, leftover space parks silently under the end
 * margin) — mixed types fall out of `resolveDims` returning something
 * different at different step indices, e.g. from profile rules (see
 * Scene.tsx's resolveBoardProfile).
 *
 * `resolveDims` is keyed by STEP INDEX, not height. Index is the loop
 * counter itself — fully known before the board's type is — so there is no
 * circular dependency and no floating-point matching anywhere in profile
 * resolution. Height-based keying was tried twice and both variants had the
 * same root flaw: any height key ultimately depends on board types, which
 * is exactly what the key is supposed to determine.
 */
export function computeBoardStack(
  totalHeightCm: number,
  resolveDims: (stepIndex: number) => ResolvedBoardDims,
): BoardStack {
  const ceilingCm = totalHeightCm - END_MARGIN_CM;
  const boards: StackedBoard[] = [];
  let cursor = ROSETTE_OFFSET_CM;
  let stepIndex = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const dims = resolveDims(stepIndex);
    const spacer = stepIndex === 0 ? 0 : dims.spacerHeightCm;
    const top = cursor + spacer + dims.boardHeightCm;
    if (top > ceilingCm) break;

    boards.push({
      centerCm: cursor + spacer + dims.boardHeightCm / 2,
      stepIndex,
      boardHeightCm: dims.boardHeightCm,
      spacerBelowCm: spacer,
      modelId: dims.modelId,
      sizeId: dims.sizeId,
    });
    cursor = top;
    stepIndex++;
  }

  return { boards, filledHeightCm: cursor };
}