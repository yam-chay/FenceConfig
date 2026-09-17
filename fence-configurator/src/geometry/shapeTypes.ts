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
 * fieldCountForLeg in fieldCalculator.ts): a straight/left/right junction
 * is a "middle" post (boards emerge from both faces,
 * SEGMENT_MIDDLE_MARGIN_CM), while 'disconnect' — like either true end of
 * the whole shape — is an "end" post (boards emerge from one face only,
 * SEGMENT_END_MARGIN_CM).
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
   * fieldCountForLeg's doc comment in fieldCalculator.ts for why the two
   * are kept separate). */
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
  isDoublePost?: boolean;
  /** Which end of the fence this post represents for endpoint-rosette placement. */
  rosetteEnd?: 'start' | 'end';
  /** Only set when isDoublePost: the heading the OUTGOING leg leaves in, after the junction's turn is applied. `heading` itself stays the incoming leg's heading (see shapeLayout.ts's no-45°-diagonal comment) — this is what lets post.ts's activeGrooveFaces find the double post's SECOND groove face, which is perpendicular to the first at a left/right corner.
   */
  outgoingHeadingRad?: number;
  baseHeightCm: number;
  heightCm: number;
}

export interface ShapeLayout {
  fields: FieldPlacement[];
  posts: PostPlacement[];
}
