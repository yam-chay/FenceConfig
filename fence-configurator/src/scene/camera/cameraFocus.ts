import type { Shape, Leg } from '../../geometry/shape';

/** Structural equality on every field that actually changes a leg's own geometry/rendering — used to tell an appended leg from a prepended one (see diffFocusLegs) by checking whether the EXISTING legs still line up unchanged from the front (append) or only from offset 1 (prepend). */
function legsEqual(a: Leg, b: Leg): boolean {
  return (
    a.lengthM === b.lengthM &&
    a.baseHeightCm === b.baseHeightCm &&
    a.heightCm === b.heightCm &&
    a.modelId === b.modelId &&
    a.sizeId === b.sizeId &&
    a.wallWidthCm === b.wallWidthCm
  );
}

/** Which leg indices changed between two shapes, and whether this kind of change is allowed to reset the viewing angle back to default. Null means nothing in legs/junctions differs (e.g. only color changed). */
export function diffFocusLegs(prev: Shape, next: Shape): { legIndices: number[]; structural: boolean } | null {
  if (next.legs.length !== prev.legs.length) {
    const added = next.legs.length > prev.legs.length;

    if (added) {
      // A new leg lands either at the END (addLeg — every existing leg
      // still lines up unchanged from the front) or at the START
      // (addLegAtStart — every existing leg shifted by one position, so
      // it only lines up from offset 1). Checked structurally rather
      // than assumed, so this stays correct regardless of which button
      // triggered it.
      const isPrepend = prev.legs.length > 0 && prev.legs.every((leg, i) => legsEqual(leg, next.legs[i + 1]));
      if (isPrepend) {
        return { legIndices: [0], structural: true };
      }
      const idx = next.legs.length - 1;
      return { legIndices: [idx], structural: true };
    }

    // Removing a leg has no single "new" leg to isolate, so that case
    // keeps framing both sides of the removal point for context.
    const idx = next.legs.length - 1;
    return {
      legIndices: [idx - 1, idx].filter((i) => i >= 0 && i < next.legs.length),
      structural: true, // adding/removing a leg — "return to default" case
    };
  }
  for (let i = 0; i < next.legs.length; i++) {
    const a = prev.legs[i];
    const b = next.legs[i];
    if (a.lengthM !== b.lengthM || a.baseHeightCm !== b.baseHeightCm || a.heightCm !== b.heightCm) {
      return {
        legIndices: [i - 1, i, i + 1].filter((idx) => idx >= 0 && idx < next.legs.length),
        structural: false, // a slider edit on an existing leg — keep the user's current angle
      };
    }
  }
  for (let i = 0; i < next.junctions.length; i++) {
    if (prev.junctions[i]?.type !== next.junctions[i]?.type) {
      return {
        legIndices: [i, i + 1].filter((idx) => idx >= 0 && idx < next.legs.length),
        structural: true, // junction direction changed — "return to default" case
      };
    }
  }
  return null;
}