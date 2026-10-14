/**
 * Snapshot format + structural validation. Shared by the browser app and the
 * /api/share function, so it must stay free of DOM and browser-only imports.
 *
 * Relative runtime imports use a `.js` extension: the Vercel function runs as
 * native ESM in Node, which (unlike Vite) needs the extension to resolve.
 */

import type { Shape, Leg, Junction } from '../geometry/shapeTypes.js';
import type { BakedStep, ColorScheme, ProfileScheme } from '../scene/types.js';
import { FENCE_CATALOG } from '../geometry/catalog.js';
import { POST_CAP_HEIGHT_CM } from '../geometry/constants.js';
import { fieldCountForLeg } from '../geometry/fieldCalculator.js';

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

/**
 * v3 — the SHARE format: what a view link stores (Redis or #view=). Not a
 * successor to v2 but a different kind of record: v2 is the editor's state
 * (every rule, in the order it was written — localStorage keeps it, since
 * editing needs it), v3 is the final result, one entry per board. Built by
 * bakeShareSnapshot (app/bakeSnapshot.ts) after the geometry is final;
 * read back by migrateSnapshot into a v2 snapshot carrying `baked` columns.
 *
 * Its size follows the fence, not the click history. Board positions are
 * NOT stored: they're re-stacked from the steps, so a step is identified by
 * its index, never by a height.
 */
export const SHARE_SNAPSHOT_VERSION = 3;

/** [lengthM, baseHeightCm, fenceHeightCm, wallWidthCm, profile] — profile indexes `profiles`. */
export type ShareLegV3 = [number, number, number, number, number];
/**
 * A run of `count` consecutive, identical fields; each column bottom up,
 * one char per step: [count, colors, profiles, spacers]. Runs, because the
 * fields of a leg are nearly always identical — without them a design with
 * no rules at all would come out larger than its v2 record.
 */
export type ShareFieldRunV3 = [number, string, string, string];

export interface ShareSnapshotV3 {
  v: typeof SHARE_SNAPSHOT_VERSION;
  /** Color palette, hex without '#'. */
  colors: string[];
  /** Profile palette: [modelId, sizeId]. */
  profiles: [string, string][];
  /** Post color — index into `colors`. */
  post: number;
  legs: ShareLegV3[];
  /** One char per junction: l(eft) r(ight) s(traight) d(isconnect). */
  junctions: string;
  /**
   * Per leg, its fields in order as runs. The color and profile strings
   * index their palettes with PALETTE_CHARS; the spacer string holds the
   * multiplier digit.
   */
  fields: ShareFieldRunV3[][];
}

/** One char per palette index — caps each palette at 62 entries. */
export const PALETTE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const JUNCTION_CODES: Record<string, Junction['type']> = { l: 'left', r: 'right', s: 'straight', d: 'disconnect' };

export type StoredSnapshot = DesignSnapshot | ShareSnapshotV3;

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

/**
 * v3 → the v2 shape the app renders: the same Shape, no rules, and every
 * field's final column in `baked`. Anything malformed returns the input
 * unchanged, so validation fails on it (v stays 3).
 */
function expandV3(x: Rec): Rec {
  const { colors, profiles, legs, junctions, fields, post } = x;
  if (!Array.isArray(colors) || !colors.every((c) => isStr(c))) return x;
  if (!Array.isArray(profiles) || !profiles.every((p) => Array.isArray(p) && p.length === 2 && catalogHas(p[0], p[1])))
    return x;
  if (!Array.isArray(legs) || !Array.isArray(fields) || fields.length !== legs.length) return x;
  if (!isStr(junctions) || !isNum(post) || !isStr(colors[post])) return x;

  const profileAt = (i: number): [string, string] | undefined => (profiles as [string, string][])[i];
  const shapeLegs: Rec[] = [];
  for (const leg of legs) {
    if (!Array.isArray(leg) || leg.length !== 5 || !leg.every(isNum)) return x;
    const profile = profileAt(leg[4]);
    if (!profile) return x;
    const [lengthM, baseHeightCm, fenceHeightCm, wallWidthCm] = leg;
    shapeLegs.push({ lengthM, baseHeightCm, fenceHeightCm, modelId: profile[0], sizeId: profile[1], wallWidthCm });
  }

  const junctionTypes = [...junctions].map((ch) => JUNCTION_CODES[ch]);
  if (junctionTypes.length !== legs.length - 1 || junctionTypes.some((t) => !t)) return x;

  const bakedColors: Record<string, string[]> = {};
  const bakedSteps: Record<string, BakedStep[]> = {};
  for (let legIndex = 0; legIndex < fields.length; legIndex++) {
    const runs: unknown = fields[legIndex];
    if (!Array.isArray(runs)) return x;
    let fieldIndex = 0;
    for (const run of runs) {
      if (!Array.isArray(run) || run.length !== 4) return x;
      const [count, c, p, sp] = run as unknown[];
      if (!Number.isInteger(count) || (count as number) < 1 || !isStr(c) || !isStr(p) || !isStr(sp)) return x;
      if (p.length !== c.length || sp.length !== c.length) return x;
      const colorsOut: string[] = [];
      const steps: BakedStep[] = [];
      for (let i = 0; i < c.length; i++) {
        const color = colors[PALETTE_CHARS.indexOf(c[i])];
        const profile = profileAt(PALETTE_CHARS.indexOf(p[i]));
        if (!isStr(color) || !profile || !/[0-9]/.test(sp[i])) return x;
        colorsOut.push(`#${color}`);
        steps.push({ modelId: profile[0], sizeId: profile[1], spacerMultiplier: Number(sp[i]) });
      }
      // Fields of one run share their (read-only) arrays.
      for (let k = 0; k < (count as number); k++, fieldIndex++) {
        bakedColors[`${legIndex}:${fieldIndex}`] = colorsOut;
        bakedSteps[`${legIndex}:${fieldIndex}`] = steps;
      }
    }
    // Every field the geometry lays out must have its column — a missing
    // one would render as a silently empty field.
    const startIsMiddle = legIndex > 0 && junctionTypes[legIndex - 1] !== 'disconnect';
    const endIsMiddle = legIndex < legs.length - 1 && junctionTypes[legIndex] !== 'disconnect';
    if (fieldIndex !== fieldCountForLeg(shapeLegs[legIndex].lengthM as number, startIsMiddle, endIsMiddle)) return x;
  }

  return {
    v: SNAPSHOT_VERSION,
    shape: { legs: shapeLegs, junctions: junctionTypes.map((type) => ({ type })) },
    colorScheme: {
      postColorHex: `#${colors[post]}`,
      // Never shown — every board that exists is baked — but required by the type.
      baseBoardColorHex: `#${colors[0] ?? colors[post]}`,
      boardRules: [],
      baked: bakedColors,
    },
    profileScheme: { rules: [], spacerRules: [], baked: bakedSteps },
  };
}

/**
 * Brings any known snapshot to the runtime SNAPSHOT_VERSION shape — v1 by
 * migration, v3 (share format) by expansion; anything else passes through
 * to fail validation.
 */
export function migrateSnapshot(x: unknown): unknown {
  if (isObj(x) && x.v === 1) return migrateV1(x);
  if (isObj(x) && x.v === SHARE_SNAPSHOT_VERSION) return expandV3(x);
  return x;
}
