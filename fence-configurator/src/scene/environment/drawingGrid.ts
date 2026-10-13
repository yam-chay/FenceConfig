import * as THREE from 'three';
import { faceOffsetDirection, type ViewFace } from '../camera/viewGizmo';

/**
 * Drawing mode's backdrop: a flat light background with a metric grid in
 * the view plane — horizontal (a plan) from above, vertical (an elevation)
 * from the sides, with a ground line at height 0.
 *
 * One camera-facing plane in its own scene, drawn before the fence with no
 * depth test. The shader works in world meters, so lines sit on real
 * 10 cm / 1 m marks and move with the fence on pan and zoom — the same
 * coordinates dimension labels will use later.
 */
export interface DrawingGrid {
  scene: THREE.Scene;
  update(opts: {
    camera: THREE.Camera;
    target: THREE.Vector3;
    face: ViewFace;
    /** How squarely the camera faces `face`, 0–1 — the grid fades in as a fly settles. */
    alignment: number;
    /** Screen pixels per world meter at the target. */
    pxPerMeter: number;
    /** Whole backdrop's opacity — the fade between the 3D world and drawing mode. */
    opacity: number;
  }): void;
  dispose(): void;
}

/** Thin lines step by powers of ten and never come closer than this on screen. */
const MIN_LINE_SPACING_PX = 8;
const PLANE_SIZE_M = 2000;

const TOP_AXIS_U = new THREE.Vector3(1, 0, 0);
const TOP_AXIS_V = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Smallest power-of-ten spacing that stays MIN_LINE_SPACING_PX apart, and how strongly to draw it as it approaches that limit. */
export function gridSpacing(pxPerMeter: number): { minorM: number; minorAlpha: number } {
  const minorM = Math.pow(10, Math.ceil(Math.log10(MIN_LINE_SPACING_PX / pxPerMeter)));
  const minorAlpha = THREE.MathUtils.clamp((minorM * pxPerMeter - MIN_LINE_SPACING_PX) / 16, 0.25, 1);
  return { minorM, minorAlpha };
}

export function createDrawingGrid(): DrawingGrid {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    uniforms: {
      uAxisU: { value: new THREE.Vector3(1, 0, 0) },
      uAxisV: { value: new THREE.Vector3(0, 1, 0) },
      uMinor: { value: 0.1 },
      uMinorAlpha: { value: 1 },
      uSide: { value: 1 },
      uAlignment: { value: 0 },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAxisU;
      uniform vec3 uAxisV;
      uniform float uMinor;
      uniform float uMinorAlpha;
      uniform float uSide;
      uniform float uAlignment;
      uniform float uOpacity;
      varying vec3 vWorld;

      // Anti-aliased grid lines, widthPx wide on screen at any zoom.
      float lines(vec2 c, float step, float widthPx) {
        vec2 g = c / step;
        vec2 a = abs(fract(g - 0.5) - 0.5) / fwidth(g);
        return 1.0 - min(min(a.x, a.y) / widthPx, 1.0);
      }

      void main() {
        const vec3 paper = vec3(0.957, 0.965, 0.973);
        vec2 c = vec2(dot(vWorld, uAxisU), dot(vWorld, uAxisV));
        vec3 col = paper;
        if (uSide > 0.5 && c.y < 0.0) col = vec3(0.905, 0.918, 0.929); // below ground
        col = mix(col, vec3(0.86, 0.885, 0.905), lines(c, uMinor, 1.0) * uMinorAlpha);
        col = mix(col, vec3(0.74, 0.775, 0.81), lines(c, uMinor * 10.0, 1.2));
        if (uSide > 0.5) {
          float ground = abs(c.y) / fwidth(c.y);
          col = mix(col, vec3(0.36, 0.42, 0.47), 1.0 - min(ground / 1.6, 1.0));
        }
        gl_FragColor = vec4(mix(paper, col, uAlignment), uOpacity);
      }`,
  });
  const geometry = new THREE.PlaneGeometry(PLANE_SIZE_M, PLANE_SIZE_M);
  const plane = new THREE.Mesh(geometry, material);
  plane.frustumCulled = false;
  scene.add(plane);

  return {
    scene,
    update({ camera, target, face, alignment, pxPerMeter, opacity }) {
      const side = face !== 'top';
      const u = material.uniforms.uAxisU.value as THREE.Vector3;
      const v = material.uniforms.uAxisV.value as THREE.Vector3;
      if (side) {
        // The horizontal world axis lying in this elevation, and straight up.
        const n = faceOffsetDirection(face);
        u.set(-n.z, 0, n.x);
        v.copy(UP);
      } else {
        u.copy(TOP_AXIS_U);
        v.copy(TOP_AXIS_V);
      }
      const { minorM, minorAlpha } = gridSpacing(pxPerMeter);
      material.uniforms.uMinor.value = minorM;
      material.uniforms.uMinorAlpha.value = minorAlpha;
      material.uniforms.uSide.value = side ? 1 : 0;
      material.uniforms.uAlignment.value = alignment;
      material.uniforms.uOpacity.value = opacity;
      plane.position.copy(target);
      plane.quaternion.copy(camera.quaternion);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
