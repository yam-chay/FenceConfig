import { MAX_FIELD_LENGTH_M, SEGMENT_END_MARGIN_CM, SEGMENT_MIDDLE_MARGIN_CM } from './constants';

const CM_PER_M = 100;

/**
 * A leg is the basic, addressable fence element — one straight run between
 * two posts (or more, once split into fields). It owns its own length,
 * existing base height, and closing height. Future per-element manipulation
 * (color, profile type) targets a leg specifically, same as it'll target an
 * individual board — so a leg is never dissolved into a bigger container.
 */
export interface Leg {
  lengthM: number;
  /** Height (cm) of the existing wall/ground this leg starts from — no floating, the post sits right on it. */
  baseHeightCm: number;
  /** This leg's own closing/top height (cm). */
  heightCm: number;
  /** Which catalog model+size this leg uses — drives board/spacer dims, not just styling. See catalog.ts. */
  modelId: string;
  sizeId: string;
  /**
   * Width/depth (cm) of the visualized existing wall this leg's posts sit
   * on — purely cosmetic, no production/order impact (unlike every other
   * Leg field). Independent per leg and user-adjustable because, unlike
   * post/board dimensions, there's no single correct constant — the real
   * wall a customer already has varies site to site. Only rendered when
   * baseHeightCm > 0; see Scene.tsx.
   */
  wallWidthCm: number;
}

/**
 * The joint between two consecutive legs.
 *
 * 'left' / 'right' (90°) and 'straight' (0°) are all a real bolted double
 * post — physically two posts bolted flush together into one unit, which is
 * why it's rendered as a SINGLE merged post, not two separate boxes. That
 * only works when both legs start from the SAME base height — a double
 * post can't have one side reach down through the other leg's taller
 * existing wall to a lower base. So these are only valid when
 * baseHeightCm (and realistically heightCm) match on both sides.
 *
 * 'disconnect' is for exactly the case where base height DOES change (with
 * or without a direction change too): there's no shared post at all, just
 * two independent ordinary posts positioned right next to each other,
 * wherever the physical wall actually steps.
 *
 * This same left/right/straight vs. disconnect split is also what decides
 * a post's SEGMENT MARGIN in the client's real field-count formula (see
 * fieldCountForLeg below): a straight/left/right junction is a "middle"
 * post (boards emerge from both faces, SEGMENT_MIDDLE_MARGIN_CM), while
 * 'disconnect' — like either true end of the whole shape — is an "end"
 * post (boards emerge from one face only, SEGMENT_END_MARGIN_CM).
 */
export interface Junction {
  type: 'left' | 'right' | 'straight' | 'disconnect';
}

/** A shape is one flat, ordered list of legs plus the junction between each consecutive pair. `junctions.length` must be `legs.length - 1`. */
export interface Shape {
  legs: Leg[];
  junctions: Junction[];
}

export interface FieldPlacement {
  legIndex: number;
  index: number;
  lengthM: number;
  /** Confirmed against the client's Excel workbook, 2026-09-16 — see
   * areas/fence-configurator-client.md. The material-order length: shorter
   * than `lengthM` by the segment margins eaten by this field's two
   * bounding post grooves. NOT currently used for any visual sizing —
   * `lengthM` still drives post placement and panel width (see
   * fieldCountForLeg's doc comment for why the two are kept separate). */
  boardLengthM: number;
  position: { x: number; z: number };
  heading: number;
  baseHeightCm: number;
  fillHeightCm: number;
}

export interface PostPlacement {
  index: number;
  /** Usually one leg. A merged double post (left/right/straight junction) belongs to BOTH of its neighboring legs. */
  legIndices: number[];
  position: { x: number; z: number };
  heading: number;
  /** True only for a real bolted double post (left/right/straight junction), rendered as one merged box. A 'disconnect' junction's two posts are independent, ordinary posts — not this. */
  /** True only for a real bolted double post (left/right/straight junction), rendered as one merged box. A 'disconnect' junction's two posts are independent, ordinary posts — not this. */
  isDoublePost?: boolean;
  /** Which end of the fence this post represents for endpoint-rosette placement. */
  rosetteEnd?: 'start' | 'end';
  /** Only set when isDoublePost: the heading the OUTGOING leg leaves in, after the junction's turn is applied. `heading` itself stays the incoming leg's heading (see the no-45°-diagonal comment below) — this is what lets post.ts's activeGrooveFaces find the double post's SECOND groove face, which is perpendicular to the first at a left/right corner.
   */
  outgoingHeadingRad?: number;
  baseHeightCm: number;
  heightCm: number;
}

export interface ShapeLayout {
  fields: FieldPlacement[];
  posts: PostPlacement[];
}

/**
 * How many fields (and so how many posts) a leg of `lengthM` splits into —
 * the client's real field-count formula, confirmed against the Excel
 * workbook 2026-09-16 (see areas/fence-configurator-client.md), not the
 * earlier naive `ceil(lengthM / MAX_FIELD_LENGTH_M)`.
 *
 * Each of the leg's own two end posts eats a segment margin out of the
 * leg's raw length — SEGMENT_MIDDLE_MARGIN_CM if that post is shared with a
 * neighboring leg that continues this one (straight/left/right junction,
 * boards emerging from both faces), or SEGMENT_END_MARGIN_CM if it's a true
 * one-face post (a real edge of the whole shape, or either side of a
 * 'disconnect'). SEGMENT_MIDDLE_MARGIN_CM is ALSO eaten once per INTERNAL
 * post as the leg splits into multiple fields — it accumulates with every
 * extra field, which is why a longer leg needs proportionally more fields
 * than a naive division would suggest.
 *
 *   fieldLength(n) = (usableCm − (n−1)×SEGMENT_MIDDLE_MARGIN_CM) / n
 *
 * `n` is the smallest count for which fieldLength(n) doesn't exceed
 * MAX_FIELD_LENGTH_M. Solved in closed form (below) rather than by looping
 * from n=1 upward — looping can both undershoot (accept an n that only
 * clears the cap before the accumulated middle-margin term, which grows
 * with n, is folded in) and overshoot (miss that a smaller n already
 * clears the cap once that term IS folded in) — both directions confirmed
 * against the client's own numbers:
 *
 *   n ≥ (usableCm + SEGMENT_MIDDLE_MARGIN_CM) / (maxFieldCm + SEGMENT_MIDDLE_MARGIN_CM)
 */
export function fieldCountForLeg(lengthM: number, startIsMiddle: boolean, endIsMiddle: boolean): number {
  const lengthCm = lengthM * CM_PER_M;
  const marginStartCm = startIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const marginEndCm = endIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const usableCm = Math.max(0, lengthCm - marginStartCm - marginEndCm);
  const maxFieldCm = MAX_FIELD_LENGTH_M * CM_PER_M;
  return Math.max(1, Math.ceil((usableCm + SEGMENT_MIDDLE_MARGIN_CM) / (maxFieldCm + SEGMENT_MIDDLE_MARGIN_CM)));
}

/**
 * `fieldLengthM` (used for post placement / panel width) stays a simple
 * even division of the leg's own measured `lengthM` — posts land at equal
 * intervals spanning exactly what the person typed into the length slider.
 * `boardLengthM` is the SEPARATE, shorter, margin-corrected order length
 * (see FieldPlacement's doc comment) — it does not feed back into where
 * posts sit or how wide a panel renders.
 */
function splitLegIntoFields(
  lengthM: number,
  startIsMiddle: boolean,
  endIsMiddle: boolean,
): { fieldLengthM: number; fieldCount: number; boardLengthM: number } {
  const fieldCount = fieldCountForLeg(lengthM, startIsMiddle, endIsMiddle);

  const lengthCm = lengthM * CM_PER_M;
  const marginStartCm = startIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const marginEndCm = endIsMiddle ? SEGMENT_MIDDLE_MARGIN_CM : SEGMENT_END_MARGIN_CM;
  const usableCm = Math.max(0, lengthCm - marginStartCm - marginEndCm);
  const boardLengthCm = (usableCm - (fieldCount - 1) * SEGMENT_MIDDLE_MARGIN_CM) / fieldCount;

  return {
    fieldLengthM: lengthM / fieldCount,
    fieldCount,
    boardLengthM: Math.max(0, boardLengthCm) / CM_PER_M,
  };
}

const TURN_RAD: Record<'left' | 'right' | 'straight', number> = {
  left: Math.PI / 2,
  right: -Math.PI / 2,
  straight: 0,
};
/** Small gap between the two independent posts at a 'disconnect' junction — just enough to read as two separate posts, not a real site distance. */
const DISCONNECT_GAP_M = 0.15;

/** Lays out the whole shape as one continuous walk. Junctions never reposition the walk to a new origin — even a 'disconnect' just continues from wherever the wall physically steps, which is what keeps its two posts close together. */
export function layoutShape(shape: Shape): ShapeLayout {
  const posts: PostPlacement[] = [];
  const fields: FieldPlacement[] = [];

  let x = 0;
  let z = 0;
  let heading = 0;

  const firstLeg = shape.legs[0];
  posts.push({
    index: 0,
    legIndices: [0],
    position: { x, z },
    heading,
    rosetteEnd: 'start',
    baseHeightCm: firstLeg.baseHeightCm,
    heightCm: firstLeg.heightCm - firstLeg.baseHeightCm,
  });

  shape.legs.forEach((leg, legIndex) => {
    const startIsMiddle = legIndex > 0 && shape.junctions[legIndex - 1]?.type !== 'disconnect';
    const endIsMiddle = legIndex < shape.legs.length - 1 && shape.junctions[legIndex]?.type !== 'disconnect';
    const { fieldLengthM, fieldCount, boardLengthM } = splitLegIntoFields(leg.lengthM, startIsMiddle, endIsMiddle);
    const fillHeightCm = leg.heightCm - leg.baseHeightCm;

    for (let f = 0; f < fieldCount; f++) {
      const midX = x + (Math.cos(heading) * fieldLengthM) / 2;
      const midZ = z + (Math.sin(heading) * fieldLengthM) / 2;
      fields.push({
        legIndex,
        index: f,
        lengthM: fieldLengthM,
        boardLengthM,
        position: { x: midX, z: midZ },
        heading,
        baseHeightCm: leg.baseHeightCm,
        fillHeightCm,
      });
      x += Math.cos(heading) * fieldLengthM;
      z += Math.sin(heading) * fieldLengthM;

      if (f < fieldCount - 1) {
        posts.push({
          index: posts.length,
          legIndices: [legIndex],
          position: { x, z },
          heading,
          baseHeightCm: leg.baseHeightCm,
          heightCm: fillHeightCm,
        });
      }
    }

    const junction = shape.junctions[legIndex];
    if (!junction) {
      posts.push({
        index: posts.length,
        legIndices: [legIndex],
        position: { x, z },
        heading,
        rosetteEnd: 'end',
        baseHeightCm: leg.baseHeightCm,
        heightCm: fillHeightCm,
      });
      return;
    }

    const nextLeg = shape.legs[legIndex + 1];

    if (junction.type === 'disconnect') {
      posts.push({
        index: posts.length,
        legIndices: [legIndex],
        position: { x, z },
        heading,
        rosetteEnd: 'end',
        baseHeightCm: leg.baseHeightCm,
        heightCm: fillHeightCm,
      });
      x += Math.cos(heading) * DISCONNECT_GAP_M;
      z += Math.sin(heading) * DISCONNECT_GAP_M;
      posts.push({
        index: posts.length,
        legIndices: [legIndex + 1],
        position: { x, z },
        heading,
        rosetteEnd: 'start',
        baseHeightCm: nextLeg.baseHeightCm,
        heightCm: nextLeg.heightCm - nextLeg.baseHeightCm,
      });
      return;
    }

    const newHeading = heading + TURN_RAD[junction.type];
    const mergedBaseHeightCm = Math.min(leg.baseHeightCm, nextLeg.baseHeightCm);
    const mergedTopHeightCm = Math.max(leg.heightCm, nextLeg.heightCm);
    posts.push({
      index: posts.length,
      legIndices: [legIndex, legIndex + 1],
      position: { x, z },
      // A double post is a physical square post, not a 45° diagonal post.
      // Keep its orientation aligned with the incoming leg. The connected
      // fence can occupy the appropriate face of the post independently.
      heading,
      isDoublePost: true,
      outgoingHeadingRad: newHeading,
      baseHeightCm: mergedBaseHeightCm,
      heightCm: mergedTopHeightCm - mergedBaseHeightCm,
    });
    heading = newHeading;
  });

  return { fields, posts };
}