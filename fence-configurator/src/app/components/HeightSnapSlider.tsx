import { useEffect, useRef, useState } from 'react';
import type { Leg } from '../../geometry/shape';
import { resolveBoardDims } from '../../geometry/catalog';
import { formatTrimmed, roundToDecimals } from '../utils/numberUtils';

/**
 * Fence height (Leg.fenceHeightCm), in plain cm — 20 to 200. The product's
 * own height: from the top of the existing wall to the top of the cap.
 * The wall never changes it — a wall edit lifts the whole fence instead.
 *
 * Any value is accepted — the closing algorithm (geometry/closure.ts)
 * picks one final step from the whole catalog to get as close as possible
 * without exceeding it. Whole-cm parts can't hit every typed value, so the
 * label also shows the height actually built when it differs (always
 * under 1 cm with the current catalog).
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
  builtHeightCm,
  onChangeHeight,
  onInteractionStart,
  onInteractionEnd,
}: {
  label: string;
  leg: Leg;
  boardCount: number;
  /** What the closing algorithm actually reached (cap included). Shown next to the requested height when they differ — whole-cm parts can't always hit a typed value exactly. */
  builtHeightCm?: number;
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
    onChangeHeight(Math.max(FLOOR_CM, Math.min(CEIL_CM, roundToDecimals(leg.fenceHeightCm + direction * stepCm, 1))));
  }

  function openEditor() {
    setEditorValue(leg.fenceHeightCm.toFixed(1));
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
          <button type="button" className="stepper-btn" onClick={() => stepBy(-1)} disabled={leg.fenceHeightCm <= FLOOR_CM} aria-label={`${label} — פחות`}>
            −
          </button>
          <button type="button" className="stepper-value" onClick={openEditor} aria-label={`הזנה ידנית — ${label}`}>
            {formatTrimmed(leg.fenceHeightCm, 1)} ס״מ
          </button>
          <button type="button" className="stepper-btn" onClick={() => stepBy(1)} disabled={leg.fenceHeightCm >= CEIL_CM} aria-label={`${label} — יותר`}>
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
        {label}: {formatTrimmed(leg.fenceHeightCm, 1)} ס״מ ({boardCount} שלבים)
        {builtHeightCm !== undefined && Math.abs(builtHeightCm - leg.fenceHeightCm) >= 0.05 && (
          <span className="built-height"> · בפועל {formatTrimmed(builtHeightCm, 1)}</span>
        )}
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
        value={leg.fenceHeightCm}
        onPointerDown={onInteractionStart}
        onPointerUp={onInteractionEnd}
        onPointerCancel={onInteractionEnd}
        onChange={(e) => onChangeHeight(Number(e.target.value))}
      />
    </div>
  );
}