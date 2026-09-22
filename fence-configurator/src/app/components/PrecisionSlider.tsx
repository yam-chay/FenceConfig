import { useEffect, useRef, useState } from 'react';
import { formatTrimmed, roundToDecimals, clampDecimalString } from '../utils/numberUtils';

export function PrecisionSlider({
  mode,
  label,
  min,
  max,
  step,
  value,
  fineValue,
  precisionOn,
  onChangeValue,
  onChangeFineValue,
  onTogglePrecision,
  onFineAdjust,
  onInteractionStart,
  onInteractionEnd,
  className,
  stepperStep,
}: {
  mode: 'length' | 'height';
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Raw fine number, already in the fine control's own unit — cm (0–99.9) for length, cm (0–0.9) for height. */
  fineValue: number;
  precisionOn: boolean;
  onChangeValue: (v: number) => void;
  onChangeFineValue: (f: number) => void;
  onTogglePrecision: (on: boolean) => void;
  /** Called right before a fine (drag/stepper/toggle) change — NOT before a
   * normal coarse slider drag and NOT before a header edit — so the caller
   * can suppress side effects (like camera reframing) that make sense for a
   * real drag but not for a tiny precision nudge. */
  onFineAdjust?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  className?: string;
  /** Mobile −/+ step, in the main unit. Defaults to `step`. */
  stepperStep?: number;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPrimary, setEditorPrimary] = useState('0'); // length: whole meters · height: full cm.d value
  const [editorSecondary, setEditorSecondary] = useState('0'); // length only: cm.d
  const primaryInputRef = useRef<HTMLInputElement | null>(null);

  const fineToMain = mode === 'length' ? 0.01 : 1; // cm -> m for length; cm -> cm (identity) for height
  const mainUnit = mode === 'length' ? 'מ׳' : 'ס״מ';
  const fineMax = mode === 'length' ? 99.9 : 0.9;
  const fineStep = 0.1;

  const appliedFine = precisionOn ? fineValue * fineToMain : 0;
  const coarse = value - appliedFine;
  const displayValue =
    mode === 'length' ? formatTrimmed(value, 3) : formatTrimmed(precisionOn ? value : coarse, 1);

  function setFine(f: number) {
    const clamped = Math.max(0, Math.min(fineMax, roundToDecimals(f, 1)));
    onFineAdjust?.();
    onChangeFineValue(clamped);
    onChangeValue(coarse + (precisionOn ? clamped * fineToMain : 0));
  }

  /** Mobile −/+: moves the coarse part, keeps any fine offset. */
  function stepBy(direction: 1 | -1) {
    const next = Math.min(max, Math.max(min, roundToDecimals(coarse + direction * (stepperStep ?? step), 3)));
    onChangeValue(next + appliedFine);
  }

  function toggle(on: boolean) {
    onFineAdjust?.();
    onTogglePrecision(on);
    onChangeValue(coarse + (on ? fineValue * fineToMain : 0));
  }

  function openEditor() {
    if (mode === 'length') {
      const whole = Math.floor(value);
      const cm = Math.max(0, Math.min(99.9, roundToDecimals((value - whole) * 100, 1)));
      setEditorPrimary(String(whole));
      setEditorSecondary(cm.toFixed(1));
    } else {
      setEditorPrimary(value.toFixed(1));
    }
    setEditorOpen(true);
  }

  // Focus + select the first field the instant the popover mounts, so the
  // very next keystroke overwrites the pre-filled value outright — no
  // click-and-delete, no double-click, no cursor dragging.
  useEffect(() => {
    if (editorOpen) {
      primaryInputRef.current?.focus();
      primaryInputRef.current?.select();
    }
  }, [editorOpen]);

  function applyEditor() {
    if (mode === 'length') {
      const whole = Math.max(0, Math.floor(Number(editorPrimary) || 0));
      const cm = Math.max(0, Math.min(99.9, roundToDecimals(Number(editorSecondary) || 0, 1)));
      onChangeFineValue(cm);
      onTogglePrecision(true);
      onChangeValue(whole + cm / 100);
    } else {
      const raw = Math.max(min, Math.min(max + 0.9, roundToDecimals(Number(editorPrimary) || 0, 1)));
      const whole = Math.floor(raw);
      const tenth = Math.min(0.9, roundToDecimals(raw - whole, 1));
      onChangeFineValue(tenth);
      onTogglePrecision(true);
      onChangeValue(raw);
    }
    setEditorOpen(false);
  }

  function handleEditorKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyEditor();
    else if (e.key === 'Escape') setEditorOpen(false);
  }

  const editorHint =
    mode === 'length'
      ? 'מטרים: מספר שלם · סנטימטרים: 0–99.9, עד ספרה אחת אחרי הנקודה'
      : `טווח ${formatTrimmed(min, 1)}–${formatTrimmed(max + 0.9, 1)} ס״מ, עד ספרה אחת אחרי הנקודה`;

  return (
    <div className={className ? `${className} has-stepper` : 'has-stepper'}>
      {/* Mobile only (CSS): −/+ instead of the slider; tapping the value opens exact entry. */}
      <div className="mobile-stepper">
        <span className="mobile-stepper-label">{label}</span>
        <div className="mobile-stepper-controls">
          <button type="button" className="stepper-btn" onClick={() => stepBy(-1)} disabled={coarse <= min} aria-label={`${label} — פחות`}>
            −
          </button>
          <button type="button" className="stepper-value" onClick={openEditor} aria-label={`הזנה ידנית — ${label}`}>
            {displayValue} {mainUnit}
          </button>
          <button type="button" className="stepper-btn" onClick={() => stepBy(1)} disabled={coarse >= max} aria-label={`${label} — יותר`}>
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
        {label}: {displayValue} {mainUnit}
      </button>

      {editorOpen && (
        <>
          <div className="value-popover-backdrop" onClick={() => setEditorOpen(false)} />
          <div className="value-popover" onKeyDown={handleEditorKeyDown} role="dialog" aria-label={`הזנה ידנית — ${label}`}>
            <div className="value-popover-title">{label} — הזנה ידנית</div>
            <div className="value-popover-fields">
              {mode === 'length' ? (
                <>
                  <span className="value-popover-field-group">
                    <input
                      ref={primaryInputRef}
                      type="number"
                      min={0}
                      step={1}
                      className="value-popover-input"
                      value={editorPrimary}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditorPrimary(e.target.value)}
                    />
                    <span className="value-popover-unit">מ׳</span>
                  </span>
                  <span className="value-popover-field-group">
                    <input
                      type="number"
                      min={0}
                      max={99.9}
                      step={0.1}
                      className="value-popover-input"
                      value={editorSecondary}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditorSecondary(clampDecimalString(e.target.value, 1))}
                    />
                    <span className="value-popover-unit">ס״מ</span>
                  </span>
                </>
              ) : (
                <span className="value-popover-field-group">
                  <input
                    ref={primaryInputRef}
                    type="number"
                    min={0}
                    step={0.1}
                    className="value-popover-input"
                    value={editorPrimary}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setEditorPrimary(clampDecimalString(e.target.value, 1))}
                  />
                  <span className="value-popover-unit">ס״מ</span>
                </span>
              )}
            </div>
            <div className="value-popover-hint">{editorHint}</div>
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
        min={min}
        max={max}
        step={step}
        value={coarse}
        onPointerDown={onInteractionStart}
        onPointerUp={onInteractionEnd}
        onPointerCancel={onInteractionEnd}
        onChange={(e) => onChangeValue(Number(e.target.value) + appliedFine)}
      />
      <div className="precision-row">
        <button type="button" className="text-btn" onClick={() => toggle(!precisionOn)}>
          {precisionOn ? 'כיבוי דיוק' : 'דיוק עדין (מתקדם)'}
        </button>
        {precisionOn && (
          <span className="precision-input">
            <input
              type="range"
              min={0}
              max={fineMax}
              step={fineStep}
              value={fineValue}
              onPointerDown={onInteractionStart}
              onPointerUp={onInteractionEnd}
              onPointerCancel={onInteractionEnd}
              onChange={(e) => setFine(Number(e.target.value))}
            />
            <span className="fine-readout">{fineValue.toFixed(1)} ס״מ</span>
          </span>
        )}
      </div>
    </div>
  );
}