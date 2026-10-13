import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  MIN_POLAR_ANGLE,
  MAX_POLAR_ANGLE,
  VIEW_FACES,
  faceOffsetDirection,
  alignedFace,
  nearestFace,
  orbitOffset,
  interpolateOffset,
  shortestAngle,
} from './viewGizmo';

const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b) < 1e-6;

describe('faceOffsetDirection', () => {
  it('puts each side camera on its axis, level with the target (a true elevation)', () => {
    expect(near(faceOffsetDirection('front'), new THREE.Vector3(0, 0, 1))).toBe(true);
    expect(near(faceOffsetDirection('back'), new THREE.Vector3(0, 0, -1))).toBe(true);
    expect(near(faceOffsetDirection('right'), new THREE.Vector3(1, 0, 0))).toBe(true);
    expect(near(faceOffsetDirection('left'), new THREE.Vector3(-1, 0, 0))).toBe(true);
  });

  it('puts the top camera overhead, leaning toward front so front reads at the bottom of the screen', () => {
    const top = faceOffsetDirection('top');
    expect(top.y).toBeCloseTo(Math.cos(MIN_POLAR_ANGLE));
    expect(top.z).toBeGreaterThan(0);
    expect(top.x).toBeCloseTo(0);
  });
});

describe('alignedFace', () => {
  it('recognises every face from its own direction, at any distance', () => {
    for (const face of VIEW_FACES) {
      expect(alignedFace(faceOffsetDirection(face).multiplyScalar(7))).toBe(face);
    }
  });

  it('returns null for a free angle like the default 3/4 view', () => {
    expect(alignedFace(new THREE.Vector3(2, 4.2, 11))).toBeNull();
  });

  it('returns null for a zero offset instead of throwing', () => {
    expect(alignedFace(new THREE.Vector3())).toBeNull();
  });
});

describe('nearestFace', () => {
  it('snaps the default 3/4 view to front', () => {
    expect(nearestFace(new THREE.Vector3(2, 4.2, 11))).toBe('front');
  });

  it('snaps a high view to top and a low side view to that side', () => {
    expect(nearestFace(new THREE.Vector3(1, 10, 2))).toBe('top');
    expect(nearestFace(new THREE.Vector3(-9, 2, 1))).toBe('left');
    expect(nearestFace(new THREE.Vector3(0.5, 1, -6))).toBe('back');
  });
});

describe('orbitOffset', () => {
  const start = new THREE.Vector3(0, 3, 4); // length 5

  it('keeps the camera distance', () => {
    expect(orbitOffset(start, 40, -25).length()).toBeCloseTo(5);
  });

  // Same sense as dragging the scene with OrbitControls: drag down raises the camera.
  it('stops at the top view however far you drag down', () => {
    const s = new THREE.Spherical().setFromVector3(orbitOffset(start, 0, 10_000));
    expect(s.phi).toBeCloseTo(MIN_POLAR_ANGLE);
  });

  it('never goes below the horizon however far you drag up', () => {
    const s = new THREE.Spherical().setFromVector3(orbitOffset(start, 0, -10_000));
    expect(s.phi).toBeCloseTo(MAX_POLAR_ANGLE);
  });

  it('turns freely all the way around horizontally', () => {
    const full = (2 * Math.PI) / 0.012;
    expect(near(orbitOffset(start, full, 0), start)).toBe(true);
  });
});

describe('interpolateOffset', () => {
  const from = faceOffsetDirection('front').multiplyScalar(6);
  const to = faceOffsetDirection('back').multiplyScalar(6);

  it('hits both ends exactly', () => {
    expect(near(interpolateOffset(from, to, 0), from)).toBe(true);
    expect(near(interpolateOffset(from, to, 1), to)).toBe(true);
  });

  it('swings around the target instead of passing through it', () => {
    expect(interpolateOffset(from, to, 0.5).length()).toBeCloseTo(6);
  });

  it('takes the short way round', () => {
    const a = faceOffsetDirection('left');
    const b = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, Math.PI / 2, THREE.MathUtils.degToRad(170)));
    const mid = new THREE.Spherical().setFromVector3(interpolateOffset(a, b, 0.5));
    // left (-90°) to almost-back (+170°) is 100° the short way, through 220°/-140°
    expect(shortestAngle(mid.theta - THREE.MathUtils.degToRad(-140))).toBeCloseTo(0, 2);
  });
});
