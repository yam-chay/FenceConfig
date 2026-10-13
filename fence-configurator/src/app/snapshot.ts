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
import { POST_CAP_HEIGHT_CM } from '../geometry/constants.js';

/**
 * RULE: bump only on an incompatible change to Shape or the rule types, and
 * ALWAYS add a migration from the previous version alongside it (see
 * migrateSnapshot) — a bump without one silently drops old local saves AND
 * breaks every view link already sent — hash links and the snapshots stored
 * in Redis for /v/<id> alike.
 *
 * v2: Leg.heightCm (top height from the GROUND) became Leg.fenceHeightCm
 * (the product's own height: wall top → cap top), and field-scoped rule
 * anchors became relative to their leg's fence base instead of the ground.
 */
export const SNAPSHOT_VERSION = 2;

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
    isNum(x.fenceHeightCm) &&
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

// ---------------------------------------------------------------------------
// Migrations — each takes the raw previous-version object and returns the
// raw next-version one; validation still runs on the result. Mutation-free.
// ---------------------------------------------------------------------------

const roundCm = (n: number) => Math.round(n * 1000) / 1000;

/**
 * v1 → v2. Old heightCm included the wall; the fence itself was
 * (heightCm − baseHeightCm) up to the post body's top, with the cap above
 * it. The new fenceHeightCm includes the cap, so it's added back here —
 * the board stack every old design fills stays identical. Field-scoped
 * rule anchors drop their leg's wall height to become fence-relative.
 */
function migrateV1(x: Rec): Rec {
  if (!isObj(x.shape) || !Array.isArray(x.shape.legs)) return x;
  const legs = x.shape.legs as unknown[];
  const baseOf = (legIndex: unknown): number => {
    const leg = isNum(legIndex) ? legs[legIndex] : undefined;
    return isObj(leg) && isNum(leg.baseHeightCm) ? leg.baseHeightCm : 0;
  };
  const migrateLeg = (leg: unknown) => {
    if (!isObj(leg) || !isNum(leg.heightCm) || !isNum(leg.baseHeightCm)) return leg;
    const { heightCm, ...rest } = leg;
    return { ...rest, fenceHeightCm: roundCm(heightCm - leg.baseHeightCm + POST_CAP_HEIGHT_CM) };
  };
  const migrateRules = (rules: unknown) =>
    Array.isArray(rules)
      ? rules.map((r) =>
          isObj(r) && r.scope === 'field' && isNum(r.anchorHeightCm)
            ? { ...r, anchorHeightCm: roundCm(r.anchorHeightCm - baseOf(r.legIndex)) }
            : r,
        )
      : rules;
  const color = isObj(x.colorScheme) ? x.colorScheme : null;
  const profile = isObj(x.profileScheme) ? x.profileScheme : null;
  return {
    ...x,
    v: 2,
    shape: { ...x.shape, legs: legs.map(migrateLeg) },
    colorScheme: color ? { ...color, boardRules: migrateRules(color.boardRules) } : x.colorScheme,
    profileScheme: profile
      ? { ...profile, rules: migrateRules(profile.rules), spacerRules: migrateRules(profile.spacerRules) }
      : x.profileScheme,
  };
}

/** Brings any known older snapshot up to SNAPSHOT_VERSION; anything else passes through to fail validation. */
export function migrateSnapshot(x: unknown): unknown {
  if (isObj(x) && x.v === 1) return migrateV1(x);
  return x;
}
