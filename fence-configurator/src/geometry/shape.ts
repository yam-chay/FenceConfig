import { MAX_FIELD_LENGTH_M } from './constants';
import { resolveBoardDims } from './catalog';

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
  position: { x: number; z: number };
  heading: number;
  baseHeightCm: number;
  fillHeightCm: number;
  boardHeightCm: number;
  spacerHeightCm: number;
}

export interface PostPlacement {
  index: number;
  /** Usually one leg. A merged double post (left/right/straight junction) belongs to BOTH of its neighboring legs. */
  legIndices: number[];
  position: { x: number; z: number };
  heading: number;
  /** True only for a real bolted double post (left/right/straight junction), rendered as one merged box. A 'disconnect' junction's two posts are independent, ordinary posts — not this. */
  isDoublePost?: boolean;
  baseHeightCm: number;
  heightCm: number;
}

export interface ShapeLayout {
  fields: FieldPlacement[];
  posts: PostPlacement[];
}

function splitLegIntoFields(lengthM: number): { fieldLengthM: number; fieldCount: number } {
  const fieldCount = Math.max(1, Math.ceil(lengthM / MAX_FIELD_LENGTH_M));
  return { fieldLengthM: lengthM / fieldCount, fieldCount };
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
    baseHeightCm: firstLeg.baseHeightCm,
    heightCm: firstLeg.heightCm - firstLeg.baseHeightCm,
  });

  shape.legs.forEach((leg, legIndex) => {
    const { fieldLengthM, fieldCount } = splitLegIntoFields(leg.lengthM);
    const fillHeightCm = leg.heightCm - leg.baseHeightCm;
    const { boardHeightCm, spacerHeightCm } = resolveBoardDims(leg.modelId, leg.sizeId);

    for (let f = 0; f < fieldCount; f++) {
      const midX = x + (Math.cos(heading) * fieldLengthM) / 2;
      const midZ = z + (Math.sin(heading) * fieldLengthM) / 2;
      fields.push({
        legIndex,
        index: f,
        lengthM: fieldLengthM,
        position: { x: midX, z: midZ },
        heading,
        baseHeightCm: leg.baseHeightCm,
        fillHeightCm,
        boardHeightCm,
        spacerHeightCm,
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
        baseHeightCm: leg.baseHeightCm,
        heightCm: fillHeightCm,
      });
      return;
    }

    const nextLeg = shape.legs[legIndex + 1];

    if (junction.type === 'disconnect') {
      // Close this leg with an ordinary post, step forward a hair, then
      // start the next leg with its own ordinary post — same heading, no
      // shared hardware. This is what lets base height jump freely.
      posts.push({
        index: posts.length,
        legIndices: [legIndex],
        position: { x, z },
        heading,
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
        baseHeightCm: nextLeg.baseHeightCm,
        heightCm: nextLeg.heightCm - nextLeg.baseHeightCm,
      });
      return;
    }

    // left / right / straight — one real, physically bolted double post.
    // Rendered as a SINGLE merged box (not two pieces): that's what the
    // hardware actually is. Sized to span BOTH sides' full range — down to
    // whichever leg's base is lower, up to whichever leg's top is higher —
    // so it never falls short of either side's boards.
    const newHeading = heading + TURN_RAD[junction.type];
    const mergedBaseHeightCm = Math.min(leg.baseHeightCm, nextLeg.baseHeightCm);
    const mergedTopHeightCm = Math.max(leg.heightCm, nextLeg.heightCm);
    posts.push({
      index: posts.length,
      legIndices: [legIndex, legIndex + 1],
      position: { x, z },
      heading: (heading + newHeading) / 2,
      isDoublePost: true,
      baseHeightCm: mergedBaseHeightCm,
      heightCm: mergedTopHeightCm - mergedBaseHeightCm,
    });
    heading = newHeading;
  });

  return { fields, posts };
}
