import { FENCE_CATALOG } from './catalog';
import { SPACER_OPTIONS } from './spacerOptions';
import type { ResolvedBoardDims } from './field';
 
/**
 * Closing a column is a coin-change problem: a known remainder, and a set
 * of "coins" (every catalog board+spacer combination, plus widening an
 * existing ×1 spacer to ×2). The old code was greedy — it took the
 * largest coin that fit and never reconsidered — which is why the top
 * board flipped model every 1-2 cm of slider travel, and why sibling
 * fields could diverge. This searches instead, and returns the SAME plan
 * for the same remainder every time.
 *
 * Every coin is generated from FENCE_CATALOG × SPACER_OPTIONS at runtime,
 * so when the client's real models land the table updates itself. Nothing
 * here hardcodes a dimension.
 */
 
/** cm → integer hundredths. All arithmetic runs in these so no float comparison ever decides whether a column closes. */
const cents = (cm: number) => Math.round(cm * 100);
 
/** How many extra boards the search may add on top of the primary pack. The remainder after packing is smaller than one primary step, so 1 covers nearly everything and 2 is the safety margin. */
const MAX_EXTRA_BOARDS = 2;
 
/** The untouched spacer. A candidate at this multiplier is an ordinary board; anything else is a deliberate gap change and ranks below it. */
const NORMAL_SPACER_MULTIPLIER = 1;
 
export interface SpacerBumpCapacity {
  /** cm added by taking one step from ×1 to ×2 — that step's own base spacer. */
  addCm: number;
  /** How many steps in this column offer that bump. */
  available: number;
}
 
export interface ClosurePlan {
  /** Extra boards to append on top, in order. */
  boards: ResolvedBoardDims[];
  /** Spacer widenings to apply, grouped by size. The caller decides which steps get them. */
  bumps: { addCm: number; count: number }[];
}
 
let candidateCache: ResolvedBoardDims[] | null = null;
 
/** Every board+spacer combination the catalog can produce. Built once — the catalog is static within a session. */
function allCandidates(): ResolvedBoardDims[] {
  if (candidateCache) return candidateCache;
  candidateCache = FENCE_CATALOG.flatMap((model) =>
    model.sizes.flatMap((size) =>
      SPACER_OPTIONS.map((opt) => ({
        modelId: model.id,
        sizeId: size.id,
        boardHeightCm: size.boardHeightCm,
        spacerHeightCm: size.spacerHeightCm * opt.value,
        baseSpacerHeightCm: size.spacerHeightCm,
        spacerMultiplier: opt.value,
      })),
    ),
  );
  return candidateCache;
}
 
/**
 * Candidates ordered by how little they disturb the column: the column's
 * own model+size first, then other sizes of the same model, then foreign
 * models. Larger step first within each group, so a closure that needs a
 * board uses as few as possible.
 */
function orderedCandidates(columnModelId: string, columnSizeId: string): ResolvedBoardDims[] {
  const rank = (d: ResolvedBoardDims) =>
    d.modelId === columnModelId ? (d.sizeId === columnSizeId ? 0 : 1) : 2;
  return [...allCandidates()].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return b.boardHeightCm + b.spacerHeightCm - (a.boardHeightCm + a.spacerHeightCm);
  });
}
 
/**
 * The catalog's physically smallest step (board + its own unmultiplied
 * spacer). Derived at runtime, never hardcoded: every row in catalog.ts is
 * still PLACEHOLDER, so a hardcoded "smallest" would silently become wrong
 * the day the client's real models land. If a dedicated closing profile is
 * ever wanted explicitly, that belongs as a flag in the catalog, not as an
 * id in here.
 */
function smallestModelSize(): { modelId: string; sizeId: string } | null {
  let best: { modelId: string; sizeId: string; step: number } | null = null;
  for (const model of FENCE_CATALOG) {
    for (const size of model.sizes) {
      const step = size.boardHeightCm + size.spacerHeightCm;
      if (!best || step < best.step) best = { modelId: model.id, sizeId: size.id, step };
    }
  }
  return best ? { modelId: best.modelId, sizeId: best.sizeId } : null;
}
 
/**
 * Fewest spacer widenings that add up to exactly `targetCents`, or null.
 * At most a handful of distinct sizes exist, so plain recursion is well
 * inside budget — and "fewest" matters: one widened gap reads as rhythm,
 * six read as a mistake.
 */
function solveBumps(
  targetCents: number,
  sizes: { addCents: number; available: number }[],
): { addCents: number; count: number }[] | null {
  if (targetCents === 0) return [];
  let best: { addCents: number; count: number }[] | null = null;
  let bestUsed = Infinity;
 
  function walk(i: number, rest: number, acc: { addCents: number; count: number }[], used: number) {
    if (rest === 0) {
      if (used < bestUsed) {
        bestUsed = used;
        best = acc.filter((e) => e.count > 0).map((e) => ({ ...e }));
      }
      return;
    }
    if (i >= sizes.length || used >= bestUsed) return;
    const { addCents, available } = sizes[i];
    const max = Math.min(available, Math.floor(rest / addCents));
    for (let count = 0; count <= max; count++) {
      acc.push({ addCents, count });
      walk(i + 1, rest - count * addCents, acc, used + count);
      acc.pop();
    }
  }
 
  walk(0, targetCents, [], 0);
  return best;
}
 
/**
 * The plan that closes `remainingCm` exactly, in strict preference order:
 *
 *   1. Extra boards of the column's OWN model+size, at the normal spacer.
 *   2. The same, allowed a x0 / x2 spacer on the added board.
 *   3. The catalog's smallest profile as well, any spacer.
 *   4. Any of the above plus widening existing gaps.
 *   5. Widening existing gaps alone.
 *
 * Two rules shape this. Changing an existing gap is a last resort: it
 * re-spaces boards that were already placed and correct. And no third
 * profile ever enters a column — a closure is either the column's own
 * board or the smallest one the catalog offers, nothing in between.
 *
 * Returns null when nothing closes it exactly. The caller leaves the
 * remainder exposed rather than approximating — under ~1 cm the cap
 * covers it, and an even top line across the fence matters more than the
 * last few millimetres.
 */
export function resolveClosure(
  remainingCm: number,
  capacity: SpacerBumpCapacity[],
  columnModelId: string,
  columnSizeId: string,
): ClosurePlan | null {
  const target = cents(remainingCm);
  if (target <= 0) return null;
 
  const sizes = capacity
    .filter((c) => c.addCm > 0 && c.available > 0)
    .map((c) => ({ addCents: cents(c.addCm), available: c.available }))
    .sort((a, b) => b.addCents - a.addCents);
 
  const toCm = (b: { addCents: number; count: number }[]) =>
    b.map((e) => ({ addCm: e.addCents / 100, count: e.count }));
 
  const all = orderedCandidates(columnModelId, columnSizeId);
  const isNormal = (d: ResolvedBoardDims) => (d.spacerMultiplier ?? 1) === NORMAL_SPACER_MULTIPLIER;
 
  // Only two profiles may ever close a column: the one the column is
  // already built from, and the catalog's smallest step. Letting the
  // search reach for ANY model meant almost every remainder found some
  // exact match, so the top board changed model roughly every centimetre
  // of slider travel — including models used nowhere else in the fence.
  const ownProfile = all.filter((d) => d.modelId === columnModelId && d.sizeId === columnSizeId);
  const smallest = smallestModelSize();
  const smallestProfile = smallest
    ? all.filter((d) => d.modelId === smallest.modelId && d.sizeId === smallest.sizeId)
    : [];
 
  const tiers: { candidates: ResolvedBoardDims[]; allowBumps: boolean }[] = [
    { candidates: ownProfile.filter(isNormal), allowBumps: false },
    { candidates: ownProfile, allowBumps: false },
    { candidates: [...ownProfile, ...smallestProfile], allowBumps: false },
    { candidates: [...ownProfile, ...smallestProfile], allowBumps: true },
  ];
 
  for (const tier of tiers) {
    if (tier.candidates.length === 0) continue;
    for (let depth = 1; depth <= MAX_EXTRA_BOARDS; depth++) {
      const plan = search(target, depth, [], tier.candidates, sizes, toCm, tier.allowBumps);
      if (plan) return plan;
    }
  }
 
  // Last resort — widening existing gaps alone.
  const spacerOnly = solveBumps(target, sizes);
  if (spacerOnly) return { boards: [], bumps: toCm(spacerOnly) };
 
  return null;
}
 
function search(
  rest: number,
  depth: number,
  chosen: ResolvedBoardDims[],
  candidates: ResolvedBoardDims[],
  sizes: { addCents: number; available: number }[],
  toCm: (b: { addCents: number; count: number }[]) => { addCm: number; count: number }[],
  allowBumps: boolean,
): ClosurePlan | null {
  if (depth === 0) {
    if (!allowBumps) return rest === 0 ? { boards: [...chosen], bumps: [] } : null;
    const bumps = solveBumps(rest, sizes);
    return bumps ? { boards: [...chosen], bumps: toCm(bumps) } : null;
  }
  for (const dims of candidates) {
    const step = cents(dims.boardHeightCm + dims.spacerHeightCm);
    if (step > rest) continue;
    chosen.push(dims);
    const plan = search(rest - step, depth - 1, chosen, candidates, sizes, toCm, allowBumps);
    chosen.pop();
    if (plan) return plan;
  }
  return null;
}