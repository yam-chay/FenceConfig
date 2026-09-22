/**
 * Design persistence — one snapshot format, two destinations:
 * localStorage (autosave in the editor) and the URL hash (view-only link).
 *
 * RULE: bump SNAPSHOT_VERSION only on an incompatible change to Shape or
 * the rule types. A bump silently drops old local saves AND breaks every
 * view link already sent — once links reach customers, add a migration
 * instead of bumping.
 */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Shape, Leg } from '../geometry/shape';
import type { ColorScheme, ProfileScheme } from '../scene/Scene';
import { FENCE_CATALOG } from '../geometry/catalog';

export const SNAPSHOT_VERSION = 1;
const STORAGE_KEY = 'mld-fence-sim:design';
const VIEW_HASH_PREFIX = '#view=';

export interface DesignSnapshot {
  v: typeof SNAPSHOT_VERSION;
  shape: Shape;
  colorScheme: ColorScheme;
  profileScheme: ProfileScheme;
}

export type AppMode = 'edit' | 'view';

export interface InitialDesign {
  mode: AppMode;
  /** null in edit mode = no save yet; null in view mode = broken link. */
  design: DesignSnapshot | null;
}

export function makeSnapshot(shape: Shape, colorScheme: ColorScheme, profileScheme: ProfileScheme): DesignSnapshot {
  return { v: SNAPSHOT_VERSION, shape, colorScheme, profileScheme };
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

function parseSnapshot(json: string | null): DesignSnapshot | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// localStorage — every call guarded: private mode, quota, disabled storage.
// ---------------------------------------------------------------------------

export function loadLocalDesign(): DesignSnapshot | null {
  try {
    return parseSnapshot(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveLocalDesign(snapshot: DesignSnapshot): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage unavailable — the editor keeps working, just without autosave.
  }
}

export function clearLocalDesign(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------------------------------------------------------------------------
// View link — compressed snapshot in the hash. The hash never reaches the
// server, and needs no routing config on Vercel.
// ---------------------------------------------------------------------------

export function isViewHash(hash: string): boolean {
  return hash.startsWith(VIEW_HASH_PREFIX);
}

export function buildShareUrl(snapshot: DesignSnapshot): string {
  const encoded = compressToEncodedURIComponent(JSON.stringify(snapshot));
  return `${window.location.origin}${window.location.pathname}${VIEW_HASH_PREFIX}${encoded}`;
}

function decodeViewHash(hash: string): DesignSnapshot | null {
  try {
    return parseSnapshot(decompressFromEncodedURIComponent(hash.slice(VIEW_HASH_PREFIX.length)));
  } catch {
    return null;
  }
}

/** Read once at startup. A view hash always means view mode — even when broken. */
export function readInitialDesign(): InitialDesign {
  const hash = window.location.hash;
  if (isViewHash(hash)) return { mode: 'view', design: decodeViewHash(hash) };
  return { mode: 'edit', design: loadLocalDesign() };
}
