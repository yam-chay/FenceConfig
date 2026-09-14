import { ROSETTE_OFFSET_CM, END_MARGIN_CM } from './constants';

export interface BoardStack {
  /** How many boards fit in the requested height. */
  boardCount: number;
  /** Vertical center offsets (cm, from post base) for each board — feeds mesh placement. */
  boardCenters: number[];
  /** Vertical center offsets (cm, from post base) for each spacer between boards. */
  spacerCenters: number[];
  /** The actual filled height achieved (may be slightly less than requested — boards are a fixed size). */
  filledHeightCm: number;
}

/**
 * Stacks boards + spacers from the rosette offset up to the requested total
 * height, respecting the end margin at the top of the groove.
 *
 * boardHeightCm/spacerHeightCm come from the selected catalog model+size
 * (see catalog.ts) — they are NOT global constants, because the same model
 * can offer multiple board/spacer combinations (e.g. the client's "חי לי
 * הייטק" model: 4cm board/1cm gap, or 2cm board/2cm gap).
 *
 * This is a first-pass approximation of the client's real Excel formula —
 * good enough to drive the spike's live geometry, but not yet validated
 * board-for-board against production data. Flagged in
 * areas/fence-configurator-client.md as a follow-up.
 */
export function computeBoardStack(totalHeightCm: number, boardHeightCm: number, spacerHeightCm: number): BoardStack {
  const usableHeight = totalHeightCm - ROSETTE_OFFSET_CM - END_MARGIN_CM;
  const unit = boardHeightCm + spacerHeightCm;
  const boardCount = Math.max(0, Math.floor((usableHeight + spacerHeightCm) / unit));

  const boardCenters: number[] = [];
  const spacerCenters: number[] = [];
  let cursor = ROSETTE_OFFSET_CM;

  for (let i = 0; i < boardCount; i++) {
    boardCenters.push(cursor + boardHeightCm / 2);
    cursor += boardHeightCm;
    if (i < boardCount - 1) {
      spacerCenters.push(cursor + spacerHeightCm / 2);
      cursor += spacerHeightCm;
    }
  }

  return {
    boardCount,
    boardCenters,
    spacerCenters,
    filledHeightCm: cursor,
  };
}
