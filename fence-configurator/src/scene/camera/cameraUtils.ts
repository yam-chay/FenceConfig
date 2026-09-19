import { VIEW_DIRECTION } from '../constants';

export const DEFAULT_POLAR = Math.acos(VIEW_DIRECTION.y);
export const DEFAULT_AZIMUTH = Math.atan2(VIEW_DIRECTION.x, VIEW_DIRECTION.z);
export const AZIMUTH_RANGE = Infinity; // full horizontal rotation — polar stays locked below
export const POLAR_RANGE = (45 * Math.PI) / 180;
export const ZOOM_IN_FACTOR = 0.55;
export const ZOOM_OUT_FACTOR = 1.7;
/** Ceiling for a fly. Long moves get this; short ones must not — a 20 cm nudge that takes as long as an 8 m sweep reads as sluggish, and a long sweep at a short duration reads as being thrown. */
export const FLY_DURATION_MS = 600;
export const FLY_DURATION_MIN_MS = 220;
export const FLY_DURATION_PER_METER_MS = 90;

/** Where the camera aims on a fence of a given height — not the base, not the top. */
export const FENCE_MID_HEIGHT_FRACTION = 0.5;
/** How far toward that mid-height one height edit moves the aim. Converges over a drag; moves a sensible fraction on a single clicked value. */
export const HEIGHT_FOLLOW_STRENGTH = 0.35;
/** Below this the aim isn't worth moving at all — stops a drag from firing 60 pointless flights a second. */
export const HEIGHT_FOLLOW_MIN_M = 0.005;

export function flyDurationFor(distanceM: number): number {
  return Math.min(
    FLY_DURATION_MS,
    Math.max(FLY_DURATION_MIN_MS, FLY_DURATION_MIN_MS + distanceM * FLY_DURATION_PER_METER_MS),
  );
}
export const CLICK_MOVE_THRESHOLD_PX = 6;
export const FOCUS_ELEMENT_PADDING = 1.15; // close zoom-in when selecting a step/post — tight enough to actually see it without manual zooming
export const FOCUS_EDIT_PADDING = 1.6; // recent-edit window: closer than full-shape, looser than a single element — reused for the deselect case too
export const FULL_SHAPE_PADDING = 1.35;

export function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}