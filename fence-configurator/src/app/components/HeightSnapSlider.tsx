import { useEffect, useRef, useState } from 'react';
import type { Leg } from '../../geometry/shape';
import { resolveBoardDims } from '../../geometry/catalog';
import { formatTrimmed, roundToDecimals } from '../utils/numberUtils';

/**
 * Fence height, in plain cm — 20 to 200. Used to snap to an exact
 * board-stack total (min/max/step derived from ONE board type, so every
 * value on the slider corresponded to a whole number of boards). Reverted
 * to plain cm jumps: with resolveBoardStepCandidates now searching every
 * model/size AND every spacer option (SPACER_OPTIONS — see
 * scene/resolvers.ts) for whatever gets closest to the target without
 * cutting a board, the worst-case leftover gap before the cap is small
 * enough (confirmed against the catalog: every step size 2–9 cm is
 * reachable, so the greedy fill never leaves more than ~1cm uncovered) —
 * and the cap already hides a gap that small. No need to constrain the
 * slider itself to discrete board-count stops anymore.
 *
 * `boardCount` is the REAL count for this leg, computed in Scene.tsx from
 * the actual per-step resolved stack (profile rules, spacer fallback
 * search included) and passed down via App's onStats callback — not an
 * approximation from the leg's default board type, which could read
 * wildly wrong (e.g. showing 25 when an explicit profile rule actually
 * put 66 boards on this leg).
 */
export function HeightSnapSlider({
  label,
  leg,
  boardCount,
  onChangeHeight,
  onInteractionStart,
  onInteractionEnd,
}: {
  label: string;
  leg: Leg;
  boardCount: number;
  onChangeHeight: (heightCm: number) => void;
onInteractionStart?: () => void;
onInteractionEnd?: () => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorValue, setEditorValue] = useState('0');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const FLOOR_CM = 20;
  const CEIL_CM = 200;

  // Mobile −/+ moves by one board + its spacer, so each tap is roughly one step.
  const dims = resolveBoardDims(leg.modelId, leg.sizeId);
  const stepCm = dims.boardHeightCm + dims.spacerHeightCm;
  function stepBy(direction: 1 | -1) {
    onChangeHeight(Math.max(FLOOR_CM, Math.min(CEIL_CM, roundToDecimals(leg.heightCm + direction * stepCm, 1))));
  }

  function openEditor() {
    setEditorValue(leg.heightCm.toFixed(1));
    setEditorOpen(true);
  }

  useEffect(() => {
    if (editorOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editorOpen]);

  function applyEditor() {
    const n = Math.max(FLOOR_CM, Math.min(CEIL_CM, roundToDecimals(Number(editorValue) || FLOOR_CM, 1)));
    onChangeHeight(n);
    setEditorOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyEditor();
    else if (e.key === 'Escape') setEditorOpen(false);
  }

  return (
    <div className="leg-row has-stepper">
      {/* Mobile only (CSS): −/+ one board at a time; tapping the value opens exact entry. */}
      <div className="mobile-stepper">
        <span className="mobile-stepper-label">
          {label}
          <small className="mobile-stepper-sub">{boardCount} שלבים</small>
        </span>
        <div className="mobile-stepper-controls">
          <button type="button" className="stepper-btn" onClick={() => stepBy(-1)} disabled={leg.heightCm <= FLOOR_CM} aria-label={`${label} — פחות`}>
            −
          </button>
          <button type="button" className="stepper-value" onClick={openEditor} aria-label={`הזנה ידנית — ${label}`}>
            {formatTrimmed(leg.heightCm, 1)} ס״מ
          </button>
          <button type="button" className="stepper-btn" onClick={() => stepBy(1)} disabled={leg.heightCm >= CEIL_CM} aria-label={`${label} — יותר`}>
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        className="value-trigger"
        onClick={openEditor}
        title="הזנה ידנית"
        aria-label={`הזנה ידנית — ${label}`}
      >
        {label}: {formatTrimmed(leg.heightCm, 1)} ס״מ ({boardCount} שלבים)
      </button>

      {editorOpen && (
        <>
          <div className="value-popover-backdrop" onClick={() => setEditorOpen(false)} />
          <div className="value-popover" onKeyDown={handleKeyDown} role="dialog" aria-label={`הזנה ידנית — ${label}`}>
            <div className="value-popover-title">{label} — הזנה ידנית</div>
            <div className="value-popover-fields">
              <span className="value-popover-field-group">
                <input
                  ref={inputRef}
                  type="number"
                  min={FLOOR_CM}
                  max={CEIL_CM}
                  step={0.1}
                  className="value-popover-input"
                  value={editorValue}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditorValue(e.target.value)}
                />
                <span className="value-popover-unit">ס״מ</span>
              </span>
            </div>
            <div className="value-popover-hint">
              טווח {FLOOR_CM}–{CEIL_CM} ס״מ
            </div>
            <div className="value-popover-actions">
              <button type="button" className="value-popover-apply" onClick={applyEditor}>
                החל
              </button>
              <button type="button" className="value-popover-cancel" onClick={() => setEditorOpen(false)}>
                ביטול
              </button>
            </div>
          </div>
        </>
      )}

      <input
        type="range"
        min={FLOOR_CM}
        max={CEIL_CM}
        step={1}
        value={leg.heightCm}
        onPointerDown={onInteractionStart}
        onPointerUp={onInteractionEnd}
        onPointerCancel={onInteractionEnd}
        onChange={(e) => onChangeHeight(Number(e.target.value))}
      />
    </div>
  );
}