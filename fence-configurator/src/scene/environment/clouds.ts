import * as THREE from 'three';

// --- Cloud sprites ---
export const CLOUD_COUNT = 30;
// Deliberately SMALLER than SKY_ORBIT_RADIUS_M (120, see dayNightCycle.ts)
// — clouds should read as closer/lower than the far sun/moon arc, not sit
// on the same shell. Each cloud jitters +/- CLOUD_RADIUS_JITTER_M off this
// base so they don't all sit on one perfect circle (flat/artificial-
// looking) — some nearer, some farther, for actual depth variation.
export const CLOUD_ORBIT_RADIUS_M = 50;
export const CLOUD_RADIUS_JITTER_M = 15;
export const CLOUD_BASE_ELEVATION_M = 15;
export const CLOUD_ELEVATION_JITTER_M = 10;
// Total azimuth width clouds are scattered across, centered on
// CAMERA_FORWARD_AZIMUTH_RAD (scene/constants.ts) — each cloud gets a
// fully random azimuth within this span (not an even index-based step),
// which is what actually spreads them apart instead of clustering them
// together.
export const CLOUD_AZIMUTH_SPAN_DEG = 200;
// Slow drift — a full 360° loop takes (360 / this) seconds, ≈12 minutes
// at this value. Purely time-driven (performance.now()), NOT tied to
// timeOfDayHours — only cloud COLOR is tied to the hour, not position.
export const CLOUD_DRIFT_DEG_PER_SEC = 0.3;
export const CLOUD_SHADOW_Y_OFFSET_M = 1.2;
export const CLOUD_SCALE_MIN = 8;
export const CLOUD_SCALE_MAX = 20;

/** Places a point on a circle of radius `radiusM` at world height
 * `elevationM`, at azimuth `azimuthRad` — same atan2(x,z) convention as
 * CAMERA_FORWARD_AZIMUTH_RAD/skyDirectionForHour (0 = along +Z,
 * increasing toward +X). Drives cloud drift, independent of
 * timeOfDayHours — driven purely by elapsed real time in the render
 * loop, not the hour slider. */
export function cloudPositionForAzimuth(azimuthRad: number, elevationM: number, radiusM: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(azimuthRad) * radiusM, elevationM, Math.cos(azimuthRad) * radiusM);
}

/** Draws one shared, blotchy soft-alpha cloud silhouette onto `canvas` —
 * several overlapping soft circles at fixed offsets, alpha compounding
 * naturally via source-over blending where they overlap, giving an
 * irregular puffy edge instead of a perfect circle. Pure white — actual
 * per-cloud tinting happens via each Sprite's own material.color (see the
 * day/night effect in Scene.tsx), not baked into this shared texture. */
export function drawCloudTexture(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const blobs: [number, number, number][] = [
    [w * 0.5, h * 0.55, w * 0.32],
    [w * 0.28, h * 0.6, w * 0.22],
    [w * 0.72, h * 0.6, w * 0.24],
    [w * 0.4, h * 0.4, w * 0.2],
    [w * 0.62, h * 0.42, w * 0.18],
  ];
  for (const [cx, cy, r] of blobs) {
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
}
