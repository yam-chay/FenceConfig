import { VIEW_DIRECTION } from '../constants';

export const DEFAULT_POLAR = Math.acos(VIEW_DIRECTION.y);
export const DEFAULT_AZIMUTH = Math.atan2(VIEW_DIRECTION.x, VIEW_DIRECTION.z);
export const AZIMUTH_RANGE = Infinity; // full horizontal rotation — polar stays locked below
export const POLAR_RANGE = (45 * Math.PI) / 180;
export const ZOOM_IN_FACTOR = 0.55;
export const ZOOM_OUT_FACTOR = 1.7;
export const FLY_DURATION_MS = 600;
export const CLICK_MOVE_THRESHOLD_PX = 6;
export const FOCUS_ELEMENT_PADDING = 1.15; // close zoom-in when selecting a step/post — tight enough to actually see it without manual zooming
export const FOCUS_EDIT_PADDING = 1.6; // recent-edit window: closer than full-shape, looser than a single element — reused for the deselect case too
export const FULL_SHAPE_PADDING = 1.35;

export function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}