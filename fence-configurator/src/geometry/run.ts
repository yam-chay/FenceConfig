import { MAX_FIELD_LENGTH_M } from './constants';

export interface FieldPlacement {
  index: number;
  lengthM: number;
  position: { x: number; z: number };
  heading: number;
}

export interface PostPlacement {
  index: number;
  position: { x: number; z: number };
  heading: number;
}

export interface RunLayout {
  fields: FieldPlacement[];
  posts: PostPlacement[];
  fieldLengthM: number;
  fieldCount: number;
}

/**
 * Splits one straight-ish leg of length `totalLengthM` into equal fields no
 * longer than MAX_FIELD_LENGTH_M (the "how many fields fit" question a
 * customer can't answer themselves), then walks post + field-center
 * positions along it. `bendAngleDegPerJoint` lets each joint pivot slightly,
 * for exercising the smooth-curve chaining case.
 *
 * Lays out ONE leg. Multi-leg shapes with 90° corners (double posts) compose
 * several of these — not wired up in this spike yet.
 */
export function layoutRun(totalLengthM: number, bendAngleDegPerJoint: number = 0): RunLayout {
  const fieldCount = Math.max(1, Math.ceil(totalLengthM / MAX_FIELD_LENGTH_M));
  const fieldLengthM = totalLengthM / fieldCount;
  const bendRad = (bendAngleDegPerJoint * Math.PI) / 180;

  const posts: PostPlacement[] = [];
  const fields: FieldPlacement[] = [];

  let x = 0;
  let z = 0;
  let heading = 0;

  posts.push({ index: 0, position: { x, z }, heading });

  for (let i = 0; i < fieldCount; i++) {
    const midX = x + (Math.cos(heading) * fieldLengthM) / 2;
    const midZ = z + (Math.sin(heading) * fieldLengthM) / 2;
    fields.push({ index: i, lengthM: fieldLengthM, position: { x: midX, z: midZ }, heading });

    x += Math.cos(heading) * fieldLengthM;
    z += Math.sin(heading) * fieldLengthM;
    heading += bendRad;

    posts.push({ index: i + 1, position: { x, z }, heading });
  }

  return { fields, posts, fieldLengthM, fieldCount };
}
