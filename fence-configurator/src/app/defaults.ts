import type { Shape } from '../geometry/shape';
import type { ColorScheme, ProfileScheme } from '../scene/Scene';
import { DEFAULT_MODEL_ID, DEFAULT_SIZE_ID, resolveBoardDims } from '../geometry/catalog';
import { ROSETTE_OFFSET_CM, POST_THICKNESS_CM, POST_ACCESSORY_WIDTH_MULTIPLIER } from '../geometry/constants';

export const FENCE_COLORS = [
  { name: 'אנתרסיט', hex: '#3a3f44' },
  { name: 'חום אגוז', hex: '#6b4a34' },
  { name: 'לבן', hex: '#e8e6e1' },
  { name: 'ירוק בקבוק', hex: '#3f5a45' },
];

/** Height (cm) for exactly `boardCount` boards of the given dims, starting
 * from baseHeightCm — same arithmetic as HeightSnapSlider's own valid-height
 * grid (one board, then +[boardHeightCm+spacerHeightCm] per extra board). */
export function heightForBoardCount(
  baseHeightCm: number,
  boardCount: number,
  boardHeightCm: number,
  spacerHeightCm: number,
): number {
  const oneBoardCm = baseHeightCm + ROSETTE_OFFSET_CM + boardHeightCm;
  const stepCm = boardHeightCm + spacerHeightCm;
  return oneBoardCm + (Math.max(1, boardCount) - 1) * stepCm;
}

export function defaultShape(): Shape {
  const dims = resolveBoardDims(DEFAULT_MODEL_ID, DEFAULT_SIZE_ID);
  return {
    legs: [
      {
        lengthM: 6,
        baseHeightCm: 0,
        heightCm: heightForBoardCount(0, 14, dims.boardHeightCm, dims.spacerHeightCm),
        modelId: DEFAULT_MODEL_ID,
        sizeId: DEFAULT_SIZE_ID,
        wallWidthCm: POST_THICKNESS_CM * POST_ACCESSORY_WIDTH_MULTIPLIER, // starts flush with the rosette sitting on it
      },
    ],
    junctions: [],
  };
}

export function defaultColorScheme(): ColorScheme {
  return {
    postColorHex: FENCE_COLORS[0].hex,
    baseBoardColorHex: FENCE_COLORS[0].hex,
    boardRules: [],
  };
}

export function defaultProfileScheme(): ProfileScheme {
  return { rules: [], spacerRules: [] };
}
