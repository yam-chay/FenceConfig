import type { Shape } from '../../geometry/shape';

/** Which leg indices changed between two shapes, and whether this kind of change is allowed to reset the viewing angle back to default. Null means nothing in legs/junctions differs (e.g. only color changed). */
export function diffFocusLegs(prev: Shape, next: Shape): { legIndices: number[]; resetAngle: boolean } | null {
  if (next.legs.length !== prev.legs.length) {
    const idx = next.legs.length - 1;
    const added = next.legs.length > prev.legs.length;
    return {
      // Adding a leg: frame ONLY the new leg. Including the neighbor too
      // meant the camera pulled back to fit whichever of the two was
      // longer — irrelevant to what you actually want to see right after
      // adding one. Removing a leg has no single "new" leg to isolate, so
      // that case keeps framing both sides of the removal point for context.
      legIndices: (added ? [idx] : [idx - 1, idx]).filter((i) => i >= 0 && i < next.legs.length),
      resetAngle: true, // adding/removing a leg — "return to default" case
    };
  }
  for (let i = 0; i < next.legs.length; i++) {
    const a = prev.legs[i];
    const b = next.legs[i];
    if (a.lengthM !== b.lengthM || a.baseHeightCm !== b.baseHeightCm || a.heightCm !== b.heightCm) {
      return {
        legIndices: [i - 1, i, i + 1].filter((idx) => idx >= 0 && idx < next.legs.length),
        resetAngle: false, // a slider edit on an existing leg — keep the user's current angle
      };
    }
  }
  for (let i = 0; i < next.junctions.length; i++) {
    if (prev.junctions[i]?.type !== next.junctions[i]?.type) {
      return {
        legIndices: [i, i + 1].filter((idx) => idx >= 0 && idx < next.legs.length),
        resetAngle: true, // junction direction changed — "return to default" case
      };
    }
  }
  return null;
}
