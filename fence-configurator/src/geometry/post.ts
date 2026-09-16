import { POST_THICKNESS_CM, GROOVE_DEPTH_CM, GROOVE_WIDTH_CM } from './constants';

/** One of the post's 4 cross-section faces, in the post's OWN local frame (before its world rotation is applied) — local +X is the direction boards leave the post at heading 0; +Z is +90° from that (a 'left' turn). See faceForDirection. */
export type PostFace = 'posX' | 'negX' | 'posZ' | 'negZ';

export interface GrooveSpec {
  face: PostFace;
  widthCm: number;
  depthCm: number;
}

export interface PostSpec {
  thicknessCm: number;
  heightCm: number;
  grooves: GrooveSpec[];
}

/**
 * Snaps a world heading direction to the nearest of the post's 4 local
 * faces, given the post's own local rotation (post.heading). Only exact
 * 90° junctions exist today (TURN_RAD in shape.ts), so this is always
 * exact — no visible snapping error. A future smooth-curve chain angle
 * (MAX_CHAIN_ANGLE_DEG) would need its own non-discrete groove treatment;
 * this function isn't meant to cover that case.
 */
export function faceForDirection(postHeadingRad: number, dirHeadingRad: number): PostFace {
  const TWO_PI = Math.PI * 2;
  let rel = (dirHeadingRad - postHeadingRad) % TWO_PI;
  if (rel < 0) rel += TWO_PI; // [0, 2π)
  const deg = (rel * 180) / Math.PI;
  if (deg < 45 || deg >= 315) return 'posX';
  if (deg < 135) return 'posZ';
  if (deg < 225) return 'negX';
  return 'negZ';
}

/**
 * Which of the post's 4 faces need an active groove — derived from the
 * SAME middle-vs-end distinction fieldCountForLeg (shape.ts) already uses
 * for the field-count formula, so a post's groove faces and its segment
 * margin are always consistent with each other by construction:
 *
 * - True end post (rosetteEnd set, legIndices.length === 1): ONE active
 *   face, pointing INTO the leg it closes ('start' -> forward, 'end' ->
 *   backward).
 * - Internal within-leg split post (legIndices.length === 1, no
 *   rosetteEnd): boards continue on BOTH sides at the same heading — two
 *   OPPOSITE active faces.
 * - Double post (isDoublePost): boards leave in the incoming leg's
 *   direction (backward) AND the outgoing leg's direction (forward, after
 *   the junction's turn) — two faces that are opposite for a 'straight'
 *   junction, perpendicular (a real corner) for 'left'/'right'.
 * - A 'disconnect' pair is just two independent end posts (each already
 *   covered by the first case above) — not handled specially here.
 */
export function activeGrooveFaces(params: {
  postHeadingRad: number;
  legIndices: number[];
  isDoublePost?: boolean;
  rosetteEnd?: 'start' | 'end';
  /** Required when isDoublePost — the outgoing leg's heading after the junction's turn (see PostPlacement.outgoingHeadingRad in shape.ts). */
  outgoingHeadingRad?: number;
}): PostFace[] {
  const { postHeadingRad, isDoublePost, rosetteEnd, outgoingHeadingRad } = params;

  if (isDoublePost && outgoingHeadingRad !== undefined) {
    const back = faceForDirection(postHeadingRad, postHeadingRad + Math.PI);
    const forward = faceForDirection(postHeadingRad, outgoingHeadingRad);
    return back === forward ? [back] : [back, forward];
  }

  if (rosetteEnd === 'start') return [faceForDirection(postHeadingRad, postHeadingRad)];
  if (rosetteEnd === 'end') return [faceForDirection(postHeadingRad, postHeadingRad + Math.PI)];

  // Internal within-leg split post: boards continue on both sides.
  return [
    faceForDirection(postHeadingRad, postHeadingRad),
    faceForDirection(postHeadingRad, postHeadingRad + Math.PI),
  ];
}

/** Pure dimension spec for one post — which faces get a groove, and the groove's own width/depth. Mesh-agnostic on purpose; Scene.tsx's buildPostGeometry turns this into actual constructive box geometry (solid core + jambs either side of an open channel on each active face, solid wall panels on every inactive face). */
export function buildPostSpec(heightCm: number, activeFaces: PostFace[]): PostSpec {
  return {
    thicknessCm: POST_THICKNESS_CM,
    heightCm,
    grooves: activeFaces.map((face) => ({ face, widthCm: GROOVE_WIDTH_CM, depthCm: GROOVE_DEPTH_CM })),
  };
}