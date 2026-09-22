import { fieldCountForLeg, layoutShape, type Shape } from './shape';
import { computeBoardStack, type ResolvedBoardDims } from './field';
import { faceForDirection, activeGrooveFaces, buildPostSpec } from './post';
import { resolveBoardDims, sizesForModel, FENCE_CATALOG } from './catalog';

const out: Record<string, unknown> = {};

// ---------- fieldCountForLeg ----------
out.fieldCountForLeg = {
  shortLeg_endEnd: fieldCountForLeg(1.0, false, false),
  atCapBoundary_endEnd: fieldCountForLeg(1.5, false, false),
  justOverCap_endEnd: fieldCountForLeg(1.51, false, false),
  longLeg_endEnd: fieldCountForLeg(6.0, false, false),
  longLeg_middleMiddle: fieldCountForLeg(6.0, true, true),
  longLeg_middleEnd: fieldCountForLeg(6.0, true, false),
  veryLong_middleMiddle: fieldCountForLeg(20.0, true, true),
  tiny_middleMiddle: fieldCountForLeg(0.3, true, true),
};

// ---------- layoutShape: scenario A — single short leg, no junction ----------
const shapeA: Shape = {
  legs: [{ lengthM: 3, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 }],
  junctions: [],
};
out.layoutShapeA_singleShortLeg = layoutShape(shapeA);

// ---------- layoutShape: scenario B — single long leg, internal split (middle margin accumulation) ----------
const shapeB: Shape = {
  legs: [{ lengthM: 10, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 }],
  junctions: [],
};
out.layoutShapeB_longLegInternalSplit = layoutShape(shapeB);

// ---------- layoutShape: scenario C — two legs, straight junction (middle post, merged) ----------
const shapeC: Shape = {
  legs: [
    { lengthM: 4, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 },
    { lengthM: 5, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 },
  ],
  junctions: [{ type: 'straight' }],
};
out.layoutShapeC_straightJunction = layoutShape(shapeC);

// ---------- layoutShape: scenario D — two legs, left (90°) corner, double post ----------
const shapeD: Shape = {
  legs: [
    { lengthM: 4, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 },
    { lengthM: 3, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 },
  ],
  junctions: [{ type: 'left' }],
};
out.layoutShapeD_leftCorner = layoutShape(shapeD);

// ---------- layoutShape: scenario E — two legs, disconnect, DIFFERENT base heights ----------
const shapeE: Shape = {
  legs: [
    { lengthM: 4, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 },
    { lengthM: 4, baseHeightCm: 20, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 },
  ],
  junctions: [{ type: 'disconnect' }],
};
out.layoutShapeE_disconnectDifferentBase = layoutShape(shapeE);

// ---------- layoutShape: scenario F — leg on existing wall, baseHeightCm > 0 (fillHeightCm check) ----------
const shapeF: Shape = {
  legs: [{ lengthM: 5, baseHeightCm: 35, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 12 }],
  junctions: [],
};
out.layoutShapeF_existingWallBase = layoutShape(shapeF);

// ---------- layoutShape: scenario G — 3 legs: straight junction into a corner, mixed ----------
const shapeG: Shape = {
  legs: [
    { lengthM: 3, baseHeightCm: 0, heightCm: 180, modelId: 'type-1', sizeId: 'size-1', wallWidthCm: 10 },
    { lengthM: 4, baseHeightCm: 0, heightCm: 160, modelId: 'type-2', sizeId: 'size-1', wallWidthCm: 10 },
    { lengthM: 2.5, baseHeightCm: 0, heightCm: 160, modelId: 'type-2', sizeId: 'size-1', wallWidthCm: 10 },
  ],
  junctions: [{ type: 'straight' }, { type: 'right' }],
};
out.layoutShapeG_threeLegsMixed = layoutShape(shapeG);

// ---------- computeBoardStack: scenario A — single board type ----------
const dimsSingle: ResolvedBoardDims = { modelId: 'type-1', sizeId: 'size-1', boardHeightCm: 7, spacerHeightCm: 1 };
out.boardStackA_singleType = computeBoardStack(180, () => [dimsSingle]);

// ---------- computeBoardStack: scenario B — mixed profile types (first 3 steps type A, rest type B) ----------
const typeA: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-1', boardHeightCm: 4, spacerHeightCm: 1 };
const typeB: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-2', boardHeightCm: 2, spacerHeightCm: 1 };
out.boardStackB_mixedProfiles = computeBoardStack(60, (stepIndex) => (stepIndex < 3 ? [typeA] : [typeB]));

// ---------- computeBoardStack: scenario C — candidate fallback closes leftover gap ----------
const wide: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-1', boardHeightCm: 4, spacerHeightCm: 1 };
const narrow: ResolvedBoardDims = { modelId: 'type-2', sizeId: 'size-2', boardHeightCm: 2, spacerHeightCm: 1 };
out.boardStackC_fallbackNarrowsToFitGap = computeBoardStack(23, () => [wide, narrow]);

// ---------- post.ts: faceForDirection across the four buckets + wraparound ----------
out.faceForDirection = {
  same: faceForDirection(0, 0),
  plus90: faceForDirection(0, Math.PI / 2),
  plus180: faceForDirection(0, Math.PI),
  plus270: faceForDirection(0, (3 * Math.PI) / 2),
  negativeRel: faceForDirection(Math.PI / 2, 0),
  nonZeroPostHeading_plus90: faceForDirection(Math.PI, (3 * Math.PI) / 2),
};

// ---------- post.ts: activeGrooveFaces ----------
out.activeGrooveFaces = {
  trueEndPost_start: activeGrooveFaces({ postHeadingRad: 0, legIndices: [0], rosetteEnd: 'start' }),
  trueEndPost_end: activeGrooveFaces({ postHeadingRad: 0, legIndices: [0], rosetteEnd: 'end' }),
  internalSplitPost: activeGrooveFaces({ postHeadingRad: 0, legIndices: [0] }),
  doublePost_straight: activeGrooveFaces({
    postHeadingRad: 0,
    legIndices: [0, 1],
    isDoublePost: true,
    outgoingHeadingRad: 0,
  }),
  doublePost_leftCorner: activeGrooveFaces({
    postHeadingRad: 0,
    legIndices: [0, 1],
    isDoublePost: true,
    outgoingHeadingRad: Math.PI / 2,
  }),
  doublePost_rightCorner: activeGrooveFaces({
    postHeadingRad: 0,
    legIndices: [0, 1],
    isDoublePost: true,
    outgoingHeadingRad: -Math.PI / 2,
  }),
};

// ---------- post.ts: buildPostSpec ----------
out.buildPostSpec = buildPostSpec(180, activeGrooveFaces({ postHeadingRad: 0, legIndices: [0] }));

// ---------- catalog.ts ----------
out.catalog = {
  known: resolveBoardDims('type-2', 'size-2'),
  unknownModel_fallsBackToFirst: resolveBoardDims('nope', 'nope'),
  unknownSizeKnownModel_fallsBackToFirstSize: resolveBoardDims('type-2', 'nope'),
  sizesForKnownModel: sizesForModel('type-2'),
  sizesForUnknownModel: sizesForModel('nope'),
  catalogLength: FENCE_CATALOG.length,
};

import { writeFileSync } from "fs";
writeFileSync(__dirname + "/__fixtures__/golden.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote __fixtures__/golden.json");
