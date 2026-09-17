import type { Shape, ShapeLayout, FieldPlacement, PostPlacement } from './shapeTypes';
import { splitLegIntoFields } from './fieldCalculator';

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
