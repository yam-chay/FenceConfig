import * as THREE from 'three';

export const VIEW_DIRECTION = new THREE.Vector3(2, 4.2, 11).normalize();

// Reorients the WHOLE arc as one rigid rotation, so sunset (hour 18)
// lands near where the camera is actually looking, offset to one side —
// rather than the raw world X axis, which had no relationship to the
// camera's framing at all. Every other hour's direction just follows
// along automatically, since it's the same arc shape, only rotated.
//
// "Where the camera looks" = the ground-plane azimuth of -VIEW_DIRECTION
// (the camera SITS along +VIEW_DIRECTION from the target, so it looks
// back along the negative of it) — same atan2(x,z) convention
// DEFAULT_AZIMUTH (in Scene.tsx) already uses, so this stays in sync
// automatically if VIEW_DIRECTION is ever retuned.
export const CAMERA_FORWARD_AZIMUTH_RAD = Math.atan2(-VIEW_DIRECTION.x, -VIEW_DIRECTION.z);
