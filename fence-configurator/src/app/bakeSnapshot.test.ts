import { describe, it, expect } from 'vitest';
import { bakeShareSnapshot } from './bakeSnapshot';
import { isValidSnapshot, migrateSnapshot, SNAPSHOT_VERSION, type DesignSnapshot, type ShareSnapshotV3 } from './snapshot';
import { fieldCountForLeg } from '../geometry/shape';
import { FENCE_CATALOG } from '../geometry/catalog';
import { SPACER_OPTIONS } from '../geometry/spacerOptions';
import { fieldBoardStack, legStackReports } from '../scene/fieldStack';
import { resolveBoardColorHex } from '../scene/resolvers';
import type { BoardColorRule, BoardProfileRule, SpacerRule } from '../scene/types';
import type { Junction, Leg } from '../geometry/shapeTypes';
import { defaultColorScheme, defaultProfileScheme, defaultShape, FENCE_COLORS } from './defaults';

/** Deterministic PRNG — a failing seed reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
  };
}

const PROFILES = FENCE_CATALOG.flatMap((m) => m.sizes.map((s) => [m.id, s.id] as const));
const COLORS = [...FENCE_COLORS.map((c) => c.hex), '#ABCDEF'];
const DIRECTIONS = ['exact', 'exact', 'below', 'above'] as const;

function fieldCounts(legs: Leg[], junctions: Junction[]): number[] {
  return legs.map((leg, i) =>
    fieldCountForLeg(
      leg.lengthM,
      i > 0 && junctions[i - 1].type !== 'disconnect',
      i < legs.length - 1 && junctions[i].type !== 'disconnect',
    ),
  );
}

/** A random editor state shaped like real use: many rules, overlapping sweeps, repaints, derived fan-out. */
function randomDesign(seed: number): DesignSnapshot {
  const r = rng(seed);
  const legCount = r.int(1, 4);
  const legs: Leg[] = Array.from({ length: legCount }, () => {
    const [modelId, sizeId] = r.pick(PROFILES);
    return {
      lengthM: Math.round((0.5 + r.next() * 9) * 100) / 100,
      baseHeightCm: r.pick([0, 0, 30, 45.5]),
      fenceHeightCm: Math.round((20 + r.next() * 180) * 10) / 10,
      modelId,
      sizeId,
      wallWidthCm: 12,
    };
  });
  const junctions: Junction[] = Array.from({ length: legCount - 1 }, () => ({
    type: r.pick(['left', 'right', 'straight', 'disconnect'] as const),
  }));
  const counts = fieldCounts(legs, junctions);

  const base = () => {
    const legIndex = r.int(0, legCount - 1);
    return {
      stepIndex: r.int(0, 30),
      anchorHeightCm: r.int(0, 200),
      direction: r.pick(DIRECTIONS),
      scope: r.next() < 0.05 ? ('global' as const) : ('field' as const),
      legIndex,
      fieldIndex: r.int(0, counts[legIndex] - 1),
      ...(r.next() < 0.2 ? { derived: true as const } : {}),
    };
  };

  const boardRules: BoardColorRule[] = Array.from({ length: r.int(0, 200) }, () => ({ ...base(), colorHex: r.pick(COLORS) }));
  const rules: BoardProfileRule[] = Array.from({ length: r.int(0, 25) }, () => {
    const [modelId, sizeId] = r.pick(PROFILES);
    return { ...base(), modelId, sizeId };
  });
  const spacerRules: SpacerRule[] = Array.from({ length: r.int(0, 25) }, () => ({
    ...base(),
    multiplier: r.pick(SPACER_OPTIONS).value,
  }));

  return {
    v: SNAPSHOT_VERSION,
    shape: { legs, junctions },
    colorScheme: { postColorHex: r.pick(COLORS), baseBoardColorHex: r.pick(COLORS), boardRules },
    profileScheme: { rules, spacerRules },
  };
}

/** Everything the scene draws per board. `closure` is left out on purpose: it marks HOW a step was chosen, which only the editor reads. */
function rendered(d: DesignSnapshot) {
  const counts = fieldCounts(d.shape.legs, d.shape.junctions);
  return {
    legs: d.shape.legs.map(({ lengthM, baseHeightCm, fenceHeightCm, wallWidthCm, modelId, sizeId }) => ({
      lengthM, baseHeightCm, fenceHeightCm, wallWidthCm, modelId, sizeId,
    })),
    junctions: d.shape.junctions.map((j) => j.type),
    postColorHex: d.colorScheme.postColorHex,
    reports: legStackReports(d.shape, d.profileScheme),
    fields: d.shape.legs.map((leg, li) =>
      Array.from({ length: counts[li] }, (_, fi) => {
        const stack = fieldBoardStack(d.profileScheme, leg, li, fi);
        return {
          filledHeightCm: stack.filledHeightCm,
          overflowCm: stack.overflowCm,
          boards: stack.boards.map((b) => ({
            stepIndex: b.stepIndex,
            centerCm: b.centerCm,
            boardHeightCm: b.boardHeightCm,
            spacerBelowCm: b.spacerBelowCm,
            spacerMultiplier: b.spacerMultiplier,
            modelId: b.modelId,
            sizeId: b.sizeId,
            overflow: !!b.overflow,
            colorHex: resolveBoardColorHex(d.colorScheme, li, fi, b.stepIndex),
          })),
        };
      }),
    ),
  };
}

/** What a viewer gets: bake → JSON (Redis / #view=) → parse → migrate → validate. */
function reopen(d: DesignSnapshot): { baked: ShareSnapshotV3; opened: DesignSnapshot } {
  const baked = bakeShareSnapshot(d);
  expect(baked).not.toBeNull();
  const opened = migrateSnapshot(JSON.parse(JSON.stringify(baked)));
  expect(isValidSnapshot(opened)).toBe(true);
  return { baked: baked!, opened: opened as DesignSnapshot };
}

describe('share format v3 — round trip', () => {
  it('renders the default design identically', () => {
    const d: DesignSnapshot = {
      v: SNAPSHOT_VERSION,
      shape: defaultShape(),
      colorScheme: defaultColorScheme(),
      profileScheme: defaultProfileScheme(),
    };
    expect(rendered(reopen(d).opened)).toEqual(rendered(d));
  });

  it('renders 500 random designs identically — color, profile, spacer, position, overflow of every board', () => {
    let boards = 0;
    let overflowing = 0;
    let closures = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const d = randomDesign(seed);
      const before = rendered(d);
      const after = rendered(reopen(d).opened);
      expect(after, `seed ${seed}`).toEqual(before);
      for (const [li, leg] of d.shape.legs.entries()) {
        before.fields[li].forEach((f, fi) => {
          boards += f.boards.length;
          if (f.overflowCm > 0) overflowing++;
          if (fieldBoardStack(d.profileScheme, leg, li, fi).boards.some((b) => b.closure)) closures++;
        });
      }
    }
    // The fuzz must actually reach the hard cases, or the equality above proves little.
    expect(boards).toBeGreaterThan(10_000);
    expect(overflowing).toBeGreaterThan(20);
    expect(closures).toBeGreaterThan(100);
  });

  it('is stable: baking a reopened design gives the same v3 again', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { baked, opened } = reopen(randomDesign(seed));
      expect(bakeShareSnapshot(opened), `seed ${seed}`).toEqual(baked);
    }
  });

  it('sizes with the fence, not with the click history', () => {
    const d = randomDesign(7);
    const repainted: DesignSnapshot = {
      ...d,
      colorScheme: {
        ...d.colorScheme,
        // Same final colors, ten times the history: every rule repeated.
        boardRules: Array.from({ length: 10 }, () => d.colorScheme.boardRules).flat(),
      },
    };
    expect(JSON.stringify(repainted).length).toBeGreaterThan(5 * JSON.stringify(d).length);
    expect(bakeShareSnapshot(repainted)).toEqual(bakeShareSnapshot(d));
  });
});

describe('share format v3 — a field holds exactly its baked steps', () => {
  it('never packs or closes past them, even with room left', () => {
    // Today's catalog always closes to < 2 cm, so the fuzz can't reach
    // this; a catalog change (taller boards, new spacers) would.
    const v3: ShareSnapshotV3 = {
      v: 3,
      colors: ['3a3f44', 'e8e6e1'],
      profiles: [['type-1', 'size-1']],
      post: 0,
      legs: [[1, 0, 200, 12, 0]],
      junctions: '',
      fields: [[[1, '01', '00', '01']]],
    };
    const opened = migrateSnapshot(v3) as DesignSnapshot;
    expect(isValidSnapshot(opened)).toBe(true);
    const stack = fieldBoardStack(opened.profileScheme, opened.shape.legs[0], 0, 0);
    expect(stack.boards.map((b) => [b.stepIndex, b.spacerMultiplier, b.closure ?? false])).toEqual([
      [0, 0, false],
      [1, 1, false],
    ]);
    expect(stack.boards.map((b) => resolveBoardColorHex(opened.colorScheme, 0, 0, b.stepIndex))).toEqual(['#3a3f44', '#e8e6e1']);
  });
});

describe('share format v3 — malformed input fails validation (→ broken-link notice, never a crash)', () => {
  const good = () => JSON.parse(JSON.stringify(bakeShareSnapshot(randomDesign(3)))) as ShareSnapshotV3;
  const cases: [string, (s: ShareSnapshotV3) => void][] = [
    ['unknown profile', (s) => (s.profiles[0] = ['type-9', 'size-1'])],
    ['color index past the palette', (s) => (s.fields[0][0][1] = 'z' + s.fields[0][0][1].slice(1))],
    ['ragged field strings', (s) => (s.fields[0][0][2] += '1')],
    ['non-digit spacer', (s) => (s.fields[0][0][3] = 'x'.repeat(s.fields[0][0][3].length))],
    ['a field missing', (s) => (s.fields[0][0][0] === 1 ? s.fields[0].pop() : s.fields[0][0][0]--)],
    ['a field too many', (s) => s.fields[0][0][0]++],
    ['zero-length run', (s) => s.fields[0].push([0, '', '', ''])],
    ['unknown junction', (s) => (s.junctions = 'q'.repeat(s.legs.length - 1) || 'q')],
    ['fields/legs mismatch', (s) => s.fields.push([])],
    ['short leg tuple', (s) => (s.legs[0] = s.legs[0].slice(0, 4) as never)],
    ['post past the palette', (s) => (s.post = 99)],
  ];
  it.each(cases)('%s', (_, mutate) => {
    const s = good();
    expect(s.fields[0][0][1].length).toBeGreaterThan(0);
    mutate(s);
    expect(isValidSnapshot(migrateSnapshot(s))).toBe(false);
  });
});

describe('share format v3 — fallback', () => {
  it('returns null (caller shares v2) when a palette would overflow', () => {
    const shape = { legs: [{ ...defaultShape().legs[0], lengthM: 20 }], junctions: [] };
    const fieldCount = fieldCounts(shape.legs, shape.junctions)[0];
    const steps = fieldBoardStack(defaultProfileScheme(), shape.legs[0], 0, 0).boards.length;
    expect(fieldCount * steps).toBeGreaterThan(62);
    // One distinct visible color per board.
    const boardRules: BoardColorRule[] = Array.from({ length: fieldCount * steps }, (_, i) => ({
      stepIndex: i % steps,
      anchorHeightCm: 0,
      colorHex: `#${i.toString(16).padStart(6, '0')}`,
      direction: 'exact',
      scope: 'field',
      legIndex: 0,
      fieldIndex: Math.floor(i / steps),
    }));
    const d: DesignSnapshot = {
      v: SNAPSHOT_VERSION,
      shape,
      colorScheme: { ...defaultColorScheme(), boardRules },
      profileScheme: defaultProfileScheme(),
    };
    expect(bakeShareSnapshot(d)).toBeNull();
  });
});
