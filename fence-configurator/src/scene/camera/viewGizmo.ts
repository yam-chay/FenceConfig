import * as THREE from 'three';

/**
 * A hair off straight down. At exactly 0 OrbitControls loses its sense of
 * "up" and the plan view spins unpredictably; 0.01 rad is visually a true
 * top view.
 */
export const MIN_POLAR_ANGLE = 0.01;
/** The horizon. The camera may look across the grass, never up at it from below. */
export const MAX_POLAR_ANGLE = Math.PI / 2;

export type CameraProjection = 'perspective' | 'orthographic';
export type ViewFace = 'front' | 'back' | 'right' | 'left' | 'top';

export const VIEW_FACES: readonly ViewFace[] = ['front', 'back', 'right', 'left', 'top'];

export const VIEW_FACE_LABELS: Record<ViewFace, string> = {
  front: 'חזית',
  back: 'אחור',
  right: 'ימין',
  left: 'שמאל',
  top: 'למעלה',
};

/**
 * Spherical angles (three.js convention: theta around +Y starting at +Z,
 * phi down from +Y) of the camera's offset from its target for each face.
 * "Front" is the side the default camera starts on (+Z, facing the first
 * leg, which always runs along +X). The top view keeps theta 0 so front
 * stays at the bottom of the screen instead of the plan coming in rotated.
 */
// Side views are dead level: drawing mode hides the grass, so a true
// elevation has nothing to lose.
const SIDE_PHI = MAX_POLAR_ANGLE;
const FACE_ANGLES: Record<ViewFace, { theta: number; phi: number }> = {
  front: { theta: 0, phi: SIDE_PHI },
  back: { theta: Math.PI, phi: SIDE_PHI },
  right: { theta: Math.PI / 2, phi: SIDE_PHI },
  left: { theta: -Math.PI / 2, phi: SIDE_PHI },
  top: { theta: 0, phi: MIN_POLAR_ANGLE },
};

/** Unit vector from the view target toward where the camera sits for this face. */
export function faceOffsetDirection(face: ViewFace): THREE.Vector3 {
  const { theta, phi } = FACE_ANGLES[face];
  return new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, phi, theta));
}

/** Within ~5.7° of a face counts as looking straight at it. */
const ALIGNED_DOT = 0.995;

/** The face the camera is looking straight at, or null for a free angle. */
export function alignedFace(offset: THREE.Vector3): ViewFace | null {
  if (offset.lengthSq() < 1e-12) return null;
  const dir = offset.clone().normalize();
  for (const face of VIEW_FACES) {
    if (dir.dot(faceOffsetDirection(face)) > ALIGNED_DOT) return face;
  }
  return null;
}

/** The face closest to the current viewing direction — where the projection toggle snaps to from a free angle. */
export function nearestFace(offset: THREE.Vector3): ViewFace {
  const dir = offset.clone().normalize();
  let best: ViewFace = 'front';
  let bestDot = -Infinity;
  for (const face of VIEW_FACES) {
    const d = dir.dot(faceOffsetDirection(face));
    if (d > bestDot) {
      bestDot = d;
      best = face;
    }
  }
  return best;
}

/** Drag on the gizmo: radians of orbit per pixel moved. */
export const GIZMO_ORBIT_RAD_PER_PX = 0.012;

/**
 * Orbits a camera offset by a pointer drag, the way dragging the scene
 * does: the model follows the pointer. Length is kept; elevation is
 * clamped between the top view and the horizon.
 */
export function orbitOffset(offset: THREE.Vector3, dxPx: number, dyPx: number): THREE.Vector3 {
  const s = new THREE.Spherical().setFromVector3(offset);
  s.theta -= dxPx * GIZMO_ORBIT_RAD_PER_PX;
  s.phi = THREE.MathUtils.clamp(s.phi - dyPx * GIZMO_ORBIT_RAD_PER_PX, MIN_POLAR_ANGLE, MAX_POLAR_ANGLE);
  return new THREE.Vector3().setFromSpherical(s);
}

/** Signed angle in (-π, π] — the short way round. */
export function shortestAngle(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

/**
 * Point t (0–1) along an arc between two camera offsets, around the
 * target rather than through it. A straight lerp from front to back would
 * pass through the fence and collapse the distance to zero halfway.
 */
export function interpolateOffset(from: THREE.Vector3, to: THREE.Vector3, t: number): THREE.Vector3 {
  const a = new THREE.Spherical().setFromVector3(from);
  const b = new THREE.Spherical().setFromVector3(to);
  return new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(
      THREE.MathUtils.lerp(a.radius, b.radius, t),
      THREE.MathUtils.lerp(a.phi, b.phi, t),
      a.theta + shortestAngle(b.theta - a.theta) * t,
    ),
  );
}
