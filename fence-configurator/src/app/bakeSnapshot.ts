import { fieldCountForLeg } from '../geometry/shape';
import { fieldBoardStack } from '../scene/fieldStack';
import { resolveBoardColorHex } from '../scene/resolvers';
import {
  JUNCTION_CODES,
  PALETTE_CHARS,
  SHARE_SNAPSHOT_VERSION,
  type DesignSnapshot,
  type ShareFieldRunV3,
  type ShareLegV3,
  type ShareSnapshotV3,
} from './snapshot';

const JUNCTION_CHAR = Object.fromEntries(Object.entries(JUNCTION_CODES).map(([ch, type]) => [type, ch]));

/** Grows a palette on first sight of a value; throws past PALETTE_CHARS. */
function palette<T>(keyOf: (v: T) => string) {
  const items: T[] = [];
  const index = new Map<string, number>();
  return {
    items,
    indexOf(v: T): number {
      const key = keyOf(v);
      let i = index.get(key);
      if (i === undefined) {
        i = items.length;
        if (i >= PALETTE_CHARS.length) throw new Error('palette overflow');
        items.push(v);
        index.set(key, i);
      }
      return i;
    },
  };
}

/**
 * Editor state (v2) → share format (v3): the final color, profile and
 * spacer of every board that exists, read from the same resolved stacks the
 * scene renders. Order matters and is one-way: profile/spacer rules decide
 * the stack (fieldBoardStack, closure included), and only then is each
 * board's color resolved — by step index, which the stack already fixed.
 * Nothing read here feeds back into the geometry.
 *
 * Returns null when the design can't be expressed in v3 (a palette over 62
 * entries, a non-digit spacer multiplier, a color that isn't '#hex') — the
 * caller then shares the v2 snapshot, which every reader still accepts.
 */
export function bakeShareSnapshot(snapshot: DesignSnapshot): ShareSnapshotV3 | null {
  const { shape, colorScheme, profileScheme } = snapshot;
  const colors = palette<string>((c) => c);
  const profiles = palette<[string, string]>(([m, s]) => `${m}\u0000${s}`);
  const hexOf = (color: string) => {
    if (!/^#[0-9A-Za-z]+$/.test(color)) throw new Error('unencodable color');
    return colors.indexOf(color.slice(1));
  };

  try {
    const post = hexOf(colorScheme.postColorHex);
    const legs: ShareLegV3[] = [];
    const fields: ShareFieldRunV3[][] = [];

    shape.legs.forEach((leg, legIndex) => {
      legs.push([leg.lengthM, leg.baseHeightCm, leg.fenceHeightCm, leg.wallWidthCm, profiles.indexOf([leg.modelId, leg.sizeId])]);
      const startIsMiddle = legIndex > 0 && shape.junctions[legIndex - 1]?.type !== 'disconnect';
      const endIsMiddle = legIndex < shape.legs.length - 1 && shape.junctions[legIndex]?.type !== 'disconnect';
      const fieldCount = fieldCountForLeg(leg.lengthM, startIsMiddle, endIsMiddle);
      const runs: ShareFieldRunV3[] = [];
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        let c = '';
        let p = '';
        let s = '';
        for (const board of fieldBoardStack(profileScheme, leg, legIndex, fieldIndex).boards) {
          if (!Number.isInteger(board.spacerMultiplier) || board.spacerMultiplier < 0 || board.spacerMultiplier > 9)
            throw new Error('unencodable spacer');
          c += PALETTE_CHARS[hexOf(resolveBoardColorHex(colorScheme, legIndex, fieldIndex, board.stepIndex))];
          p += PALETTE_CHARS[profiles.indexOf([board.modelId, board.sizeId])];
          s += String(board.spacerMultiplier);
        }
        const last = runs.at(-1);
        if (last && last[1] === c && last[2] === p && last[3] === s) last[0]++;
        else runs.push([1, c, p, s]);
      }
      fields.push(runs);
    });

    return {
      v: SHARE_SNAPSHOT_VERSION,
      colors: colors.items,
      profiles: profiles.items,
      post,
      legs,
      junctions: shape.junctions.map((j) => JUNCTION_CHAR[j.type]).join(''),
      fields,
    };
  } catch {
    return null;
  }
}
