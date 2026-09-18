import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PostSpec } from '../../geometry/post';
import { GROOVE_DEPTH_CM } from '../../geometry/constants';

/** Builds one merged, constructive post geometry — solid core inset by GROOVE_DEPTH_CM on every side, plus per-face solid wall panels (inactive faces) or paired jambs flanking an open channel (active faces, from spec.grooves). All pieces are merged into ONE BufferGeometry so a post still costs exactly one draw call, same as the old single-box version — grooves shouldn't regress the validated mobile draw-call numbers. */
export function buildPostGeometry(spec: PostSpec): THREE.BufferGeometry {
  const thicknessM = spec.thicknessCm / 100;
  const heightM = spec.heightCm / 100;
  const grooveDepthM = GROOVE_DEPTH_CM / 100; // single shared depth today — see constants.ts
  const half = thicknessM / 2;
  const coreSizeM = Math.max(0.01, thicknessM - 2 * grooveDepthM);

  const NORMAL_COLOR = new THREE.Color(1, 1, 1); // white — vertex color × material.color = material.color unchanged
  // Subtle fake-AO at the back of each open channel — no real shadow-casting is set up in the scene, so this is what makes the groove read as a recess. Kept LIGHT deliberately per "טיפה בהירה" — a rendering aid, not a real dimension, so it's a local constant here rather than in constants.ts.
  const GROOVE_SHADOW_COLOR = new THREE.Color(0.72, 0.72, 0.72);
  // Thin sliver at the CLOSED end of the channel, flush against the core's own face.
  const SHADOW_LIP_DEPTH_M = Math.min(grooveDepthM * 0.35, 0.006);

  const pieces: THREE.BufferGeometry[] = [];
  function addBox(sizeX: number, sizeZ: number, localX: number, localZ: number, color: THREE.Color) {
    const geo = new THREE.BoxGeometry(sizeX, heightM, sizeZ);
    geo.translate(localX, 0, localZ);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pieces.push(geo);
  }

  addBox(coreSizeM, coreSizeM, 0, 0, NORMAL_COLOR); // core, always present

  const grooveByFace = new Map(spec.grooves.map((g) => [g.face, g]));
  const faceDefs: { face: 'posX' | 'negX' | 'posZ' | 'negZ'; axis: 'x' | 'z'; sign: 1 | -1 }[] = [
    { face: 'posX', axis: 'x', sign: 1 },
    { face: 'negX', axis: 'x', sign: -1 },
    { face: 'posZ', axis: 'z', sign: 1 },
    { face: 'negZ', axis: 'z', sign: -1 },
  ];

  for (const { face, axis, sign } of faceDefs) {
    const groove = grooveByFace.get(face);
    const outerOffset = sign * (half - grooveDepthM / 2); // flush against this face, inner edge meets the core

    if (!groove) {
      if (axis === 'x') addBox(grooveDepthM, thicknessM, outerOffset, 0, NORMAL_COLOR);
      else addBox(thicknessM, grooveDepthM, 0, outerOffset, NORMAL_COLOR);
      continue;
    }

    const grooveWidthM = Math.min(Math.max(groove.widthCm / 100, 0), thicknessM - 0.01);
    const jambWidthM = Math.max(0, (thicknessM - grooveWidthM) / 2);
    if (jambWidthM <= 0.001) continue; // groove spans (almost) the whole face — nothing to render

    const jambCenter = half - jambWidthM / 2;
    if (axis === 'x') {
      addBox(grooveDepthM, jambWidthM, outerOffset, jambCenter, NORMAL_COLOR);
      addBox(grooveDepthM, jambWidthM, outerOffset, -jambCenter, NORMAL_COLOR);
    } else {
      addBox(jambWidthM, grooveDepthM, jambCenter, outerOffset, NORMAL_COLOR);
      addBox(jambWidthM, grooveDepthM, -jambCenter, outerOffset, NORMAL_COLOR);
    }

    // Shadow lip — flush with the core's own face, extending SHADOW_LIP_DEPTH_M outward into the channel, spanning exactly grooveWidthM.
    const lipInnerAxis = sign * (half - grooveDepthM);
    const lipCenter = lipInnerAxis + sign * (SHADOW_LIP_DEPTH_M / 2);
    if (axis === 'x') addBox(SHADOW_LIP_DEPTH_M, grooveWidthM, lipCenter, 0, GROOVE_SHADOW_COLOR);
    else addBox(grooveWidthM, SHADOW_LIP_DEPTH_M, 0, lipCenter, GROOVE_SHADOW_COLOR);
  }
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged ?? new THREE.BoxGeometry(thicknessM, heightM, thicknessM);
}
