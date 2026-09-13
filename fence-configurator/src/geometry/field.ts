import {
  BOARD_HEIGHT_CM,
  SPACER_HEIGHT_CM,
  ROSETTE_OFFSET_CM,
  END_MARGIN_CM,
} from './constants';

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
 * This is a first-pass approximation of the client's real Excel formula —
 * good enough to drive the spike's live geometry, but not yet validated
 * board-for-board against production data. Flagged in
 * areas/fence-configurator-client.md as a follow-up.
 */
export function computeBoardStack(totalHeightCm: number): BoardStack {
  const usableHeight = totalHeightCm - ROSETTE_OFFSET_CM - END_MARGIN_CM;
  const unit = BOARD_HEIGHT_CM + SPACER_HEIGHT_CM;
  const boardCount = Math.max(0, Math.floor((usableHeight + SPACER_HEIGHT_CM) / unit));

  const boardCenters: number[] = [];
  const spacerCenters: number[] = [];
  let cursor = ROSETTE_OFFSET_CM;

  for (let i = 0; i < boardCount; i++) {
    boardCenters.push(cursor + BOARD_HEIGHT_CM / 2);
    cursor += BOARD_HEIGHT_CM;
    if (i < boardCount - 1) {
      spacerCenters.push(cursor + SPACER_HEIGHT_CM / 2);
      cursor += SPACER_HEIGHT_CM;
    }
  }

  return {
    boardCount,
    boardCenters,
    spacerCenters,
    filledHeightCm: cursor,
  };
}
