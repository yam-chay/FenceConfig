/**
 * Locked production constants for the aluminum fence system.
 *
 * "Locked" = fixed per component, doesn't change with user input (post height
 * being the one exception — see run.ts). Everything here in CM unless noted.
 *
 * Confirmed from the client's Excel workbooks (fence profile/field calc +
 * post ordering calc), 2026-09-12 — see areas/fence-configurator-client.md.
 * Anything marked PLACEHOLDER has not been confirmed yet and must be
 * replaced with real numbers before this feeds a production build.
 *
 * Board height and spacer height moved OUT of this file — they're no longer
 * global, they come from the selected catalog model+size. See catalog.ts.
 */

// --- Confirmed constants ---
/** Height eaten at the post's base by the rosette — boards start above this, not at wall height 0. */
export const ROSETTE_OFFSET_CM = 2;
/** Margin at the top/bottom of the board stack inside the groove. */
export const END_MARGIN_CM = 0;
/** Margin used mid-field in the client's field-count formula. */
export const MIDDLE_MARGIN_CM = 4;
/** Longest span a single field (post-to-post) can be before it must split into another field. */
export const MAX_FIELD_LENGTH_M = 1.5;
/** Spacer width, matches SPACER_HEIGHT_CM (same part, used between boards and between chained posts). */
export const SPACER_WIDTH_CM = 1;

// --- PLACEHOLDER: not yet confirmed by the client, needed for accurate geometry ---
/** Post cross-section thickness. PLACEHOLDER — client hasn't confirmed real dimension. */
export const POST_THICKNESS_CM = 6;
/** Depth of each of the post's 4 grooves. PLACEHOLDER. */
export const GROOVE_DEPTH_CM = 1.5;
/** Board thickness. Client's rough estimate was "1-2cm" — PLACEHOLDER until exact. */
export const BOARD_THICKNESS_CM = 1.5;
/** Max angle (degrees) a chained post can pivot before the smooth-curve tolerance limit is hit. PLACEHOLDER. */
export const MAX_CHAIN_ANGLE_DEG = 15;
