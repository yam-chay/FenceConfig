import { POST_THICKNESS_CM, GROOVE_DEPTH_CM } from './constants';

export interface PostSpec {
  thicknessCm: number;
  heightCm: number;
  grooveDepthCm: number;
}

/** Pure dimension spec for one post at a given total fence height. Mesh-agnostic on purpose. */
export function buildPostSpec(heightCm: number): PostSpec {
  return {
    thicknessCm: POST_THICKNESS_CM,
    heightCm,
    grooveDepthCm: GROOVE_DEPTH_CM,
  };
}
