import { useEffect, useRef, useState } from 'react';
import type { Selection } from '../../scene/Scene';

/**
 * Leg accordion + camera-focus + scroll-sync state, extracted from App().
 * Same caveat as useHistory.ts: this closes over state passed in from App
 * (here just `selection`), it isn't a pure standalone function.
 *
 * `setExpandedLegIndices` is returned (not just `toggleLeg`) because
 * addLeg/removeLastLeg in useFenceEditor also need to open/close the
 * accordion directly when the shape's leg count changes.
 */
export function usePanelState(selection: Selection | null) {
  // Leg accordion: which legs are expanded to full edit mode (a closed leg
  // shows only a one-line summary). More than one can be open at once —
  // opening never closes another. Leg 0 starts open since that's the only
  // leg a fresh project has.
  const [expandedLegIndices, setExpandedLegIndices] = useState<Set<number>>(() => new Set([0]));
  const legRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const legFocusNonceRef = useRef(0);
  // Fires the leg-level camera fly-to in Scene — only set when a leg's
  // header is clicked OPEN from the panel (never on collapse, never on a
  // scene click, which already has its own tight element-level zoom).
  const [legCameraFocus, setLegCameraFocus] = useState<{ legIndex: number; nonce: number } | null>(null);
  // Tracks which leg the panel last auto-scrolled to, so a scene click that
  // stays within the same leg (extending a multi/range step selection)
  // doesn't re-trigger a scroll jump every time.
  const lastAutoScrolledLegRef = useRef<number | null>(null);

  // Clicking an open leg's header collapses it back to the summary line, no
  // camera change. Clicking a closed leg's header opens it AND flies the
  // camera to frame that whole leg.
  function toggleLeg(legIndex: number) {
    setExpandedLegIndices((prev) => {
      const next = new Set(prev);

      if (next.has(legIndex)) {
        next.delete(legIndex);
      } else {
        next.add(legIndex);
      }

      return next;
    });

    // Every header click triggers camera focus:
    // opening AND closing the same leg.
    legFocusNonceRef.current += 1;
    setLegCameraFocus({
      legIndex,
      nonce: legFocusNonceRef.current,
    });
  }

  // Selecting a step in the SCENE syncs the panel to it: makes sure that
  // leg's accordion tab is open (never closes any other open tab) and
  // scrolls it into view — but only once per leg, not on every step within
  // a multi/range selection on a leg that's already in view.
  useEffect(() => {
    if (selection?.kind !== 'board') {
      lastAutoScrolledLegRef.current = null;
      return;
    }
    const { legIndex } = selection;
    setExpandedLegIndices((prev) => (prev.has(legIndex) ? prev : new Set(prev).add(legIndex)));
    if (lastAutoScrolledLegRef.current !== legIndex) {
      lastAutoScrolledLegRef.current = legIndex;
      requestAnimationFrame(() => {
        legRefs.current[legIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [selection]);

  return { expandedLegIndices, setExpandedLegIndices, legRefs, legCameraFocus, toggleLeg };
}
