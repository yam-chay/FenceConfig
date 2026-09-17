import { useEffect, useRef, useState } from 'react';
import type { Leg } from '../../geometry/shape';
import { ROSETTE_OFFSET_CM } from '../../geometry/constants';
import { formatTrimmed } from '../utils/numberUtils';

/**
 * Closing height, confirmed to always snap to an exact board-stack total —
 * no fine-precision mode here (unlike base height): any sub-board offset
 * would reintroduce the exact top gap this is meant to eliminate.
 *
 * Consecutive board counts differ by exactly one board + one spacer, so
 * valid heights form a plain arithmetic sequence: min = baseHeightCm +
 * ROSETTE_OFFSET_CM + boardHeightCm (one board), then every +
 * (boardHeightCm + spacerHeightCm) after that. A native range input
 * reproduces that on its own via min/step — no discrete snapping logic
 * needed in the UI. min/max are then nudged onto the nearest valid rung at
 * or past the practical 60/200cm bounds the coarse height slider used to
 * use directly.
 *
 * The popover here asks for a board COUNT, not a height — guaranteeing
 * validity by construction rather than by clamping a typed decimal.
 */
export function HeightSnapSlider({
  label,
  leg,
  boardHeightCm,
  spacerHeightCm,
  onChangeHeight,
}: {
  label: string;
  leg: Leg;
  boardHeightCm: number;
  spacerHeightCm: number;
  onChangeHeight: (heightCm: number) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCount, setEditorCount] = useState('1');
  const countInputRef = useRef<HTMLInputElement | null>(null);

  const FLOOR_CM = 60;
  const CEIL_CM = 200;
  const stepCm = boardHeightCm + spacerHeightCm;
  const oneBoardCm = leg.baseHeightCm + ROSETTE_OFFSET_CM + boardHeightCm;
  const stepsToFloor = Math.max(0, Math.ceil((FLOOR_CM - oneBoardCm) / stepCm));
  const minCm = oneBoardCm + stepsToFloor * stepCm;
  const stepsToCeil = Math.max(0, Math.floor((CEIL_CM - oneBoardCm) / stepCm));
  const maxCm = Math.max(minCm, oneBoardCm + stepsToCeil * stepCm);

  const boardCount = Math.max(1, Math.round((leg.heightCm - oneBoardCm) / stepCm) + 1);

  function openEditor() {
    setEditorCount(String(boardCount));
    setEditorOpen(true);
  }

  useEffect(() => {
    if (editorOpen) {
      countInputRef.current?.focus();
      countInputRef.current?.select();
    }
  }, [editorOpen]);

  function applyEditor() {
    const n = Math.max(1, Math.round(Number(editorCount) || 1));
    onChangeHeight(oneBoardCm + (n - 1) * stepCm);
    setEditorOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyEditor();
    else if (e.key === 'Escape') setEditorOpen(false);
  }

  return (
    <div className="leg-row">
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
            <div className="value-popover-title">{label} — מספר שלבים</div>
            <div className="value-popover-fields">
              <span className="value-popover-field-group">
                <input
                  ref={countInputRef}
                  type="number"
                  min={1}
                  step={1}
                  className="value-popover-input"
                  value={editorCount}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditorCount(e.target.value.replace(/[^\d]/g, ''))}
                />
                <span className="value-popover-unit">שלבים</span>
              </span>
            </div>
            <div className="value-popover-hint">הגובה תמיד ייצמד למספר שלם של שלבים — אין פער בקצה העליון</div>
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
        min={minCm}
        max={maxCm}
        step={stepCm}
        value={leg.heightCm}
        onChange={(e) => onChangeHeight(Number(e.target.value))}
      />
    </div>
  );
}
