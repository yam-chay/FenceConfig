/** What got clicked — a post (color applies to ALL posts) or a board at a given absolute height (color applies via the below/above split). */
export type Selection =
  | { kind: 'post' }
  | {
    kind: 'board';
    legIndex: number;
    fieldIndex: number;
    heightCm: number;
    stepIndex: number;
    stepIndices: number[];
    stepHeights: Record<number, number>;
  };

/**
 * One coloring action, in the order it was taken. Later rules override
 * earlier ones for any board they both match — this is what makes "last
 * action wins" work automatically, including for overlapping below/above
 * ranges, with no separate recency flag needed.
 */
export interface BoardColorRule {
  /** Step index (0 = bottom board), not height — same reasoning as BoardProfileRule: keying on height meant a spacer/profile/base-height change silently detached a color rule from the board it was meant for, since the board's absolute height moved but the rule's stored height didn't. */
  stepIndex: number;
  colorHex: string;
  anchorHeightCm: number;
  /** 'exact' = just the one board clicked. 'below'/'above' = that board and everything toward the ground/sky, within this rule's scope. */
  direction: 'exact' | 'below' | 'above';
  /** 'field' = just the column of boards between the 2 posts this was clicked in. 'global' = every field in the whole shape. */
  scope: 'field' | 'global';
  legIndex?: number;
  fieldIndex?: number;
  derived?: true;
}

export interface ColorScheme {
  postColorHex: string;
  /** Used by any board no rule below applies to. */
  baseBoardColorHex: string;
  boardRules: BoardColorRule[];
}

/**
 * One profile-type action, in the order it was taken — same match semantics
 * as BoardColorRule ('exact'/'below'/'above', 'field'/'global' scope, later
 * rules win), but keyed on STEP INDEX instead of height. Color can safely
 * key on height because it's resolved AFTER geometry is final; profile
 * cannot, because profile DETERMINES geometry — any height key circularly
 * depends on the very types being resolved. Step index (0 = bottom board)
 * is just the stacking walk's loop counter: always known first, matched by
 * plain integer equality, no epsilon anywhere.
 */
export interface BoardProfileRule {
  stepIndex: number;
  anchorHeightCm: number;
  modelId: string;
  sizeId: string;
  direction: 'exact' | 'below' | 'above';
  scope: 'field' | 'global';
  legIndex?: number;
  fieldIndex?: number;
  derived?: true;
}

export interface ProfileScheme {
  rules: BoardProfileRule[];
  spacerRules: SpacerRule[];
  derived?: true;
}

/**
 * Same rule machinery as BoardProfileRule, but the payload is a multiplier
 * on the spacer BELOW a step (×0 zero, ×1 normal, ×2 double). Step 0
 * defaults to ×0 (see resolveSpacerMultiplier) — a default, not a law of
 * the geometry: a rule on step 0 raises the whole stack off the rosette.
 */
export interface SpacerRule {
  stepIndex: number;
  anchorHeightCm: number;
  multiplier: number;
  direction: 'exact' | 'below' | 'above';
  scope: 'field' | 'global';
  legIndex?: number;
  fieldIndex?: number;
  derived?: true;
}

/** A camera framing target — world-space center + a radius to fit in view. Shared between geometry (which computes real bounds from the built meshes) and camera (which flies to/frames these targets). */
export interface FrameTarget {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
}

/** One leg's world-space footprint, accumulated while building its posts/fields — used both for the initial full-shape framing and for per-leg camera focus (opening an accordion tab). */
export interface LegBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topM: number;
}