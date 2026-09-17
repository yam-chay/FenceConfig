/**
 * Barrel re-export — kept so every existing import of './geometry/shape'
 * (App.tsx, Scene.tsx, shape.test.ts, ...) keeps working UNCHANGED after
 * the stage-2 split into shapeTypes.ts / fieldCalculator.ts /
 * shapeLayout.ts. See "תוכנית ריפקטור ואופטימיזציה — Fence Configurator",
 * stage 2. No import elsewhere in the codebase needs to change because of
 * this split.
 */
export type { Leg, Junction, Shape, FieldPlacement, PostPlacement, ShapeLayout } from './shapeTypes';
export { fieldCountForLeg, splitLegIntoFields } from './fieldCalculator';
export { layoutShape } from './shapeLayout';
