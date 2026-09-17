import { MAX_FIELD_LENGTH_M, SEGMENT_END_MARGIN_CM, SEGMENT_MIDDLE_MARGIN_CM } from './constants';

const CM_PER_M = 100;

/**
 * How many fields (and so how many posts) a leg of `lengthM` splits into —
 * the client's real field-count formula, confirmed against the Excel
 * workbook 2026-09-16 (see areas/fence-configurator-client.md), not the
 * earlier naive `ceil(lengthM / MAX_FIELD_LENGTH_M)`.
 *
 * Each of the leg's own two end posts eats a segment margin out of the
 * leg's raw length — SEGMENT_MIDDLE_MARGIN_CM if that post is shared with a
 * neighboring leg that continues this one (straight/left/right junction,
 * boards emerging from both faces), or SEGMENT_END_MARGIN_CM if it's a true
 * one-face post (a real edge of the whole shape, or either side of a
 * 'disconnect'). SEGMENT_MIDDLE_MARGIN_CM is ALSO eaten once per INTERNAL
 * post as the leg splits into multiple fields — it accumulates with every
 * extra field, which is why a longer leg needs proportionally more fields
 * than a naive division would suggest.
 *
 *   fieldLength(n) = (usableCm − (n−1)×SEGMENT_MIDDLE_MARGIN_CM) / n
 *
 * `n` is the smallest count for which fieldLength(n) doesn't exceed
 * MAX_FIELD_LENGTH_M. Solved in closed form (below) rather than by looping
 * from n=1 upward — looping can both undershoot (accept an n that only
 * clears the cap before the accumulated middle-margin term, which grows
 * with n, is folded in) and overshoot (miss that a smaller n already
 * clears the cap once that term IS folded in) — both directions confirmed
 * against the client's own numbers:
 *
 *   n ≥ (usableCm + SEGMENT_MIDDLE_MARGIN_CM) / (maxFieldCm + SEGMENT_MIDDLE_MARGIN_CM)
 */
export function fieldCountForLeg(lengthM: number, startIsMiddle: boolean, endIsMiddle: boolean): number {
  const lengthCm = lengthM * CM_PER_M;
  const marginStartCm = startIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const marginEndCm = endIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const usableCm = Math.max(0, lengthCm - marginStartCm - marginEndCm);
  const maxFieldCm = MAX_FIELD_LENGTH_M * CM_PER_M;
  return Math.max(1, Math.ceil((usableCm + SEGMENT_MIDDLE_MARGIN_CM) / (maxFieldCm + SEGMENT_MIDDLE_MARGIN_CM)));
}

/**
 * `fieldLengthM` (used for post placement / panel width) stays a simple
 * even division of the leg's own measured `lengthM` — posts land at equal
 * intervals spanning exactly what the person typed into the length slider.
 * `boardLengthM` is the SEPARATE, shorter, margin-corrected order length
 * (see FieldPlacement's doc comment in shapeTypes.ts) — it does not feed
 * back into where posts sit or how wide a panel renders.
 *
 * Exported (was private to shape.ts) so shapeLayout.ts can call it.
 */
export function splitLegIntoFields(
  lengthM: number,
  startIsMiddle: boolean,
  endIsMiddle: boolean,
): { fieldLengthM: number; fieldCount: number; boardLengthM: number } {
  const fieldCount = fieldCountForLeg(lengthM, startIsMiddle, endIsMiddle);

  const lengthCm = lengthM * CM_PER_M;
  const marginStartCm = startIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const marginEndCm = endIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const usableCm = Math.max(0, lengthCm - marginStartCm - marginEndCm);
  const boardLengthCm = (usableCm - (fieldCount - 1) * SEGMENT_MIDDLE_MARGIN_CM) / fieldCount;

  return {
    fieldLengthM: lengthM / fieldCount,
    fieldCount,
    boardLengthM: Math.max(0, boardLengthCm) / CM_PER_M,
  };
}
