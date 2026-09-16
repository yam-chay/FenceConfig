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
/** Height eaten at the post's base by the rosette — boards start above this, not at wall height 0. This is the ONLY vertical margin: the board stack fills all the way up to the closing height, with no reserved gap at the top (see field.ts's computeBoardStack). */
export const ROSETTE_OFFSET_CM = 2;
/**
 * Horizontal (segment-length) margin eaten by the recess/groove cut into an
 * END post — a post where boards emerge from only one face: a true edge of
 * the whole shape, or either side of a 'disconnect' junction. Belongs to
 * the field-count formula (see shape.ts's fieldCountForLeg) — NOT the
 * vertical board stack, despite the similar-sounding old name this constant
 * used to have.
 */
export const SEGMENT_END_MARGIN_CM = 5.75;
/**
 * Horizontal (segment-length) margin eaten by the recess/groove cut into a
 * MIDDLE post — a post shared by two legs that continue one another
 * (straight/left/right junction), where boards emerge from both faces.
 * Also eaten once per INTERNAL post as a single leg splits into multiple
 * fields, so it accumulates with every extra field along a run — see
 * shape.ts's fieldCountForLeg.
 */
export const SEGMENT_MIDDLE_MARGIN_CM = 4;
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
/** Width of the channel opening on an active groove face — must clear BOARD_THICKNESS_CM plus insertion play. Derived, not independent, so it can't drift out of sync if board thickness changes. PLACEHOLDER until BOARD_THICKNESS_CM itself is confirmed. */
export const GROOVE_WIDTH_CM = BOARD_THICKNESS_CM + 0.5;
/** Max angle (degrees) a chained post can pivot before the smooth-curve tolerance limit is hit. PLACEHOLDER. */
export const MAX_CHAIN_ANGLE_DEG = 15;
/** Width multiplier for the rosette accessory plate relative to the post's own cross-section — "roughly double" per Yam's description of the real part, not a measured dimension. The cap (see POST_CAP_HEIGHT_CM) is NOT scaled by this — it matches the post's own width/depth exactly. PLACEHOLDER. */
export const POST_ACCESSORY_WIDTH_MULTIPLIER = 2;
/** How far the post cap's apex rises above the post's own top — it's modeled as a flat dome (a squashed hemisphere) exactly as wide/deep as the post itself, sealing the grooves so boards can't slide out. Purely cosmetic — sits ABOVE the closing height and never affects the board stack's own math (confirmed: there is no vertical top margin — see ROSETTE_OFFSET_CM above). PLACEHOLDER — client hasn't given a real cap dimension yet. */
export const POST_CAP_HEIGHT_CM = 1;
/**
 * How far the visualized existing wall extends PAST a true end post's own
 * face — either edge of the whole shape, or either side of a 'disconnect'
 * — so it reads as a real finished wall edge instead of stopping exactly
 * flush with the post. NOT applied at any ordinary straight/left/right
 * junction or internal within-leg split, where the wall stops flush on
 * purpose (see Scene.tsx). Purely cosmetic, Yam's own visual call — not
 * something to ask the client for.
 */
export const WALL_END_OVERHANG_CM = 2;
