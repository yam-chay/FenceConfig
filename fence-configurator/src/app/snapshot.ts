/**
 * Snapshot format + structural validation. Shared by the browser app and the
 * /api/share function, so it must stay free of DOM and browser-only imports.
 *
 * Relative runtime imports use a `.js` extension: the Vercel function runs as
 * native ESM in Node, which (unlike Vite) needs the extension to resolve.
 */

import type { Shape, Leg } from '../geometry/shapeTypes.js';
import type { ColorScheme, ProfileScheme } from '../scene/types.js';
import { FENCE_CATALOG } from '../geometry/catalog.js';

export const SNAPSHOT_VERSION = 1;

export interface DesignSnapshot {
  v: typeof SNAPSHOT_VERSION;
  shape: Shape;
  colorScheme: ColorScheme;
  profileScheme: ProfileScheme;
}

// ---------------------------------------------------------------------------
// Validation — structural, not exhaustive. Catches old/foreign/corrupted
// data before it reaches geometry code, where it would crash instead.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const isObj = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

const JUNCTION_TYPES = new Set(['left', 'right', 'straight', 'disconnect']);
const DIRECTIONS = new Set(['exact', 'below', 'above']);

/** The catalog is still placeholder — ids can disappear between versions. */
function catalogHas(modelId: unknown, sizeId: unknown): boolean {
  if (!isStr(modelId) || !isStr(sizeId)) return false;
  const model = FENCE_CATALOG.find((m) => m.id === modelId);
  return !!model && model.sizes.some((s) => s.id === sizeId);
}

function isLeg(x: unknown): x is Leg {
  return (
    isObj(x) &&
    isNum(x.lengthM) &&
    isNum(x.baseHeightCm) &&
    isNum(x.heightCm) &&
    isNum(x.wallWidthCm) &&
    catalogHas(x.modelId, x.sizeId)
  );
}

function isShape(x: unknown): x is Shape {
  if (!isObj(x) || !Array.isArray(x.legs) || !Array.isArray(x.junctions)) return false;
  if (x.legs.length === 0 || !x.legs.every(isLeg)) return false;
  if (x.junctions.length !== x.legs.length - 1) return false;
  return x.junctions.every((j) => isObj(j) && isStr(j.type) && JUNCTION_TYPES.has(j.type));
}

/** Fields shared by color, profile and spacer rules. */
function isRuleBase(r: unknown): r is Rec {
  if (!isObj(r) || !isNum(r.stepIndex) || !isNum(r.anchorHeightCm)) return false;
  if (!isStr(r.direction) || !DIRECTIONS.has(r.direction)) return false;
  if (r.scope === 'global') return true;
  return r.scope === 'field' && isNum(r.legIndex) && isNum(r.fieldIndex);
}

function isColorScheme(x: unknown): x is ColorScheme {
  return (
    isObj(x) &&
    isStr(x.postColorHex) &&
    isStr(x.baseBoardColorHex) &&
    Array.isArray(x.boardRules) &&
    x.boardRules.every((r) => isRuleBase(r) && isStr(r.colorHex))
  );
}

function isProfileScheme(x: unknown): x is ProfileScheme {
  return (
    isObj(x) &&
    Array.isArray(x.rules) &&
    Array.isArray(x.spacerRules) &&
    x.rules.every((r) => isRuleBase(r) && catalogHas(r.modelId, r.sizeId)) &&
    x.spacerRules.every((r) => isRuleBase(r) && isNum(r.multiplier))
  );
}

export function isValidSnapshot(x: unknown): x is DesignSnapshot {
  return (
    isObj(x) &&
    x.v === SNAPSHOT_VERSION &&
    isShape(x.shape) &&
    isColorScheme(x.colorScheme) &&
    isProfileScheme(x.profileScheme)
  );
}
