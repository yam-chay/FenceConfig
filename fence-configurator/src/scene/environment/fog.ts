/**
 * Horizon fog — dissolves the ground plane's hard edge into the sky.
 *
 * THREE.Fog (linear), not FogExp2: exponential fog has no `near`, it starts
 * at the camera. Linear gives an explicit clear zone, which is the whole
 * requirement here — nothing near the camera or the fence may be touched.
 *
 * Fog is per-material (opt-out via `fog: false`), and defaults to TRUE on
 * MeshBasicMaterial and SpriteMaterial. The sun/moon discs, their halos and
 * the clouds all sit far past `far`, so without disableFog() on them they
 * vanish into the horizon color. See disableFog below.
 */

import * as THREE from 'three';

/** Clear space kept beyond the farthest camera position, meters. */
export const FOG_CLEAR_MARGIN_M = 12;
/** Distance over which fog goes from none to full, meters. */
export const FOG_DEPTH_M = 55;
/** Floor for `near` — keeps tiny fences from fogging at close range. */
export const FOG_MIN_NEAR_M = 30;
/** Fallback color, overwritten per hour from the sky's horizon stop. */
const FOG_FALLBACK_COLOR = 0xdfe7ee;

export function createSceneFog(): THREE.Fog {
  return new THREE.Fog(FOG_FALLBACK_COLOR, FOG_MIN_NEAR_M, FOG_MIN_NEAR_M + FOG_DEPTH_M);
}

/**
 * Pushes the fog band out past anything the camera can ever frame.
 *
 * `near` is derived from the camera's OWN maximum distance rather than its
 * current one: a range that tracked live distance would make the horizon
 * lighten and darken during every zoom. Static per shape, recomputed only
 * when the constraints themselves change.
 */
export function applyFogRange(
  fog: THREE.Fog,
  maxCameraDistanceM: number,
  fenceRadiusM: number,
): void {
  const near = Math.max(
    FOG_MIN_NEAR_M,
    maxCameraDistanceM + Math.max(fenceRadiusM, 1) + FOG_CLEAR_MARGIN_M,
  );
  fog.near = near;
  fog.far = near + FOG_DEPTH_M;
}

/** Opt materials out of fog — for the sky bodies, which live past `far`. */
export function disableFog(...materials: Array<THREE.Material & { fog?: boolean }>): void {
  for (const material of materials) {
    material.fog = false;
    material.needsUpdate = true;
  }
}
