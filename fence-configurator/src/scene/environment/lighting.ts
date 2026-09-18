// Shadow map resolution — higher = sharper shadow edges, more GPU cost.
// Bumped from 1024: at that size covering a frustum sized to the whole
// fence, each shadow-map texel could be several cm across — bigger than
// the board/spacer gaps, so fine detail (the groove/step lines between
// boards) got blurred away entirely. 2048 roughly quarters texel size.
// Watch FPS on mobile after this change — drop back to 1024 if it tanks.
export const SHADOW_MAP_SIZE = 4096;
// Extra margin (meters) added around the fence's own bounds when sizing
// the shadow camera frustum — keeps a board/post near the EDGE of the
// fence from losing its shadow just because its bounding box was exactly
// on the frustum's boundary. Kept small on purpose: every extra meter of
// margin spreads the same SHADOW_MAP_SIZE texel budget thinner, directly
// costing the fine board-gap detail this frustum needs to resolve.
export const SHADOW_FRUSTUM_MARGIN_M = 0.5;
