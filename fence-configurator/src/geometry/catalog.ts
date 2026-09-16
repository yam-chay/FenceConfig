/**
 * Placeholder fence-model catalog. Numeric/generic IDs on purpose — per the
 * client's actual catalog (screenshots reviewed 2026-09-14), each MODEL can
 * offer multiple SIZES, and a size is a board-height + spacer-height pair
 * (e.g. "לוח 4 ס״מ רווח 1 ס״מ" vs "לוח 2 ס״מ רווח 2 ס״מ" for the same
 * model). That's real geometry, not styling — it drives computeBoardStack.
 *
 * This file is the seam: once the client's real model table (id + name +
 * reference image + dims) exists, swap the contents here without touching
 * anything that reads FENCE_CATALOG.
 */

export interface FenceModelSize {
  id: string;
  /** Later: a display name like "לוח 4 ס״מ רווח 1 ס״מ". */
  name?: string;
  boardHeightCm: number;
  spacerHeightCm: number;
}

export interface FenceModel {
  id: string;
  /** Later: the client's real model name (e.g. "דור לי"). */
  name?: string;
  /** Later: a reference photo URL for the type carousel. */
  imageUrl?: string;
  sizes: FenceModelSize[];
}

export const FENCE_CATALOG: FenceModel[] = [
  {
    id: 'type-1',
    sizes: [{ id: 'size-1', boardHeightCm: 7, spacerHeightCm: 1 }],
  },
  {
    id: 'type-2',
    sizes: [
      { id: 'size-1', boardHeightCm: 4, spacerHeightCm: 1 },
      { id: 'size-2', boardHeightCm: 2, spacerHeightCm: 1 },
    ],
  },
  {
    id: 'type-3',
    // PLACEHOLDER dims — haven't been given this model's real board/spacer yet.
    sizes: [{ id: 'size-1', boardHeightCm: 5, spacerHeightCm: 1 }],
  },
];

export const DEFAULT_MODEL_ID = FENCE_CATALOG[0].id;
export const DEFAULT_SIZE_ID = FENCE_CATALOG[0].sizes[0].id;

export function resolveBoardDims(modelId: string, sizeId: string): { boardHeightCm: number; spacerHeightCm: number } {
  const model = FENCE_CATALOG.find((m) => m.id === modelId) ?? FENCE_CATALOG[0];
  const size = model.sizes.find((s) => s.id === sizeId) ?? model.sizes[0];
  return { boardHeightCm: size.boardHeightCm, spacerHeightCm: size.spacerHeightCm };
}

/** All sizes offered for one model — used to search for a narrower fallback size when the default doesn't fit a remaining gap. Empty array for an unknown modelId, never throws. */
export function sizesForModel(modelId: string): FenceModelSize[] {
  return FENCE_CATALOG.find((m) => m.id === modelId)?.sizes ?? [];
}
