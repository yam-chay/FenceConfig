import { useEffect, useRef, useState } from 'react';
import Scene, {
  type ColorScheme,
  type ProfileScheme,
  type Selection,
  type BoardColorRule,
  type BoardProfileRule,
  type SpacerRule,
  resolveBoardColorHex,
  resolveBoardProfile,
  resolveSpacerMultiplier,
  resolveBoardStepCandidates,
} from './scene/Scene';
import type { Shape, Leg, Junction } from './geometry/shape';
import { fieldCountForLeg } from './geometry/shape';
import { DEFAULT_MODEL_ID, DEFAULT_SIZE_ID, FENCE_CATALOG, resolveBoardDims } from './geometry/catalog';
import { computeBoardStack } from './geometry/field';
import { ROSETTE_OFFSET_CM, POST_THICKNESS_CM, POST_ACCESSORY_WIDTH_MULTIPLIER } from './geometry/constants';
import './App.css';

const FENCE_COLORS = [
  { name: 'אנתרסיט', hex: '#3a3f44' },
  { name: 'חום אגוז', hex: '#6b4a34' },
  { name: 'לבן', hex: '#e8e6e1' },
  { name: 'ירוק בקבוק', hex: '#3f5a45' },
];

const JUNCTION_LABELS: Record<Junction['type'], string> = {
  right: 'שמאלה',
  left: 'ימינה',
  straight: 'ישר',
  disconnect: 'נתק',
};

/** Height (cm) for exactly `boardCount` boards of the given dims, starting
 * from baseHeightCm — same arithmetic as HeightSnapSlider's own valid-height
 * grid (one board, then +[boardHeightCm+spacerHeightCm] per extra board). */
function heightForBoardCount(baseHeightCm: number, boardCount: number, boardHeightCm: number, spacerHeightCm: number): number {
  const oneBoardCm = baseHeightCm + ROSETTE_OFFSET_CM + boardHeightCm;
  const stepCm = boardHeightCm + spacerHeightCm;
  return oneBoardCm + (Math.max(1, boardCount) - 1) * stepCm;
}

function defaultShape(): Shape {
  const dims = resolveBoardDims(DEFAULT_MODEL_ID, DEFAULT_SIZE_ID);
  return {
    legs: [
      {
        lengthM: 6,
        baseHeightCm: 0,
        heightCm: heightForBoardCount(0, 14, dims.boardHeightCm, dims.spacerHeightCm),
        modelId: DEFAULT_MODEL_ID,
        sizeId: DEFAULT_SIZE_ID,
        wallWidthCm: POST_THICKNESS_CM * POST_ACCESSORY_WIDTH_MULTIPLIER, // starts flush with the rosette sitting on it
      },
    ],
    junctions: [],
  };
}

function defaultColorScheme(): ColorScheme {
  return {
    postColorHex: FENCE_COLORS[0].hex,
    baseBoardColorHex: FENCE_COLORS[0].hex,
    boardRules: [],
  };
}

function defaultProfileScheme(): ProfileScheme {
  return { rules: [], spacerRules: [] };
}

/** Rounds to the given number of decimals — the one shared guard behind
 * every "no more than N digits after the point" constraint below. */
function roundToDecimals(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Formats to `decimals` places, then trims trailing zeros (and a bare
 * trailing dot) so a whole number reads as "6", not "6.000". */
function formatTrimmed(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Applied to a free-typed decimal field on every keystroke — truncates
 * anything past `maxDecimals` digits after the point, so it's never
 * possible to type a second/third decimal digit in the first place. */
function clampDecimalString(raw: string, maxDecimals: number): string {
  const dot = raw.indexOf('.');
  if (dot === -1) return raw;
  return raw.slice(0, dot + 1 + maxDecimals);
}

function PrecisionSlider({
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
  className,
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
  className?: string;
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
    <div className={className}>
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
              onChange={(e) => setFine(Number(e.target.value))}
            />
            <span className="fine-readout">{fineValue.toFixed(1)} ס״מ</span>
          </span>
        )}
      </div>
    </div>
  );
}

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
function HeightSnapSlider({
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

export default function App() {
  const [shape, setShape] = useState<Shape>(defaultShape());
  const [colorScheme, setColorScheme] = useState<ColorScheme>(defaultColorScheme());
  const [profileScheme, setProfileScheme] = useState<ProfileScheme>(defaultProfileScheme());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pendingBoardColor, setPendingBoardColor] = useState(FENCE_COLORS[0].hex);
  const [pendingModelId, setPendingModelId] = useState(DEFAULT_MODEL_ID);
  const [pendingSizeId, setPendingSizeId] = useState(DEFAULT_SIZE_ID);
  const [pendingSpacer, setPendingSpacer] = useState(1);
  const [applyToAllFields, setApplyToAllFields] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(260);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // "החל על כל הגדר" feedback: a toast with an immediate undo (which just
  // calls the existing undo() below — the action already lands as one
  // normal history entry, same as any other edit), an extra clarification
  // line shown only the first time it's ever used this session, and a brief
  // pulse on the corner undo button run in parallel with the toast.
  const [applyFenceToast, setApplyFenceToast] = useState<{ showHint: boolean } | null>(null);
  const [hasShownApplyFenceHint, setHasShownApplyFenceHint] = useState(false);
  const [undoPulse, setUndoPulse] = useState(false);
  const applyFenceToastTimeoutRef = useRef<number | null>(null);
  const undoPulseTimeoutRef = useRef<number | null>(null);

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
  // Set to true right before a fine-precision nudge changes a leg value, so
  // Scene's camera-reframing effect skips just that one update — a tiny
  // hundredths adjustment shouldn't fly the camera around the way a real
  // slider drag legitimately does.
  const skipNextFocusRef = useRef(false);

  // Fine-precision state for the three leg sliders (length/base
  // height/closing height) — kept OUTSIDE Leg on purpose. The slider always
  // controls the coarse value at its normal step; hundredths + on/off live
  // here per leg, and only get folded into the leg's real value
  // (lengthM/baseHeightCm/heightCm) when their toggle is on. Turning the
  // toggle off drops the fine offset from the value but keeps the
  // hundredths remembered here for next time.
  type Precision = { fine: number; on: boolean };
  const [lengthPrecision, setLengthPrecision] = useState<Record<number, Precision>>({});
  const [baseHeightPrecision, setBaseHeightPrecision] = useState<Record<number, Precision>>({});

  function getPrecision(map: Record<number, Precision>, legIndex: number): Precision {
    return map[legIndex] ?? { fine: 0, on: false };
  }

  // Undo/redo — covers everything in shape + colorScheme (lengths, heights,
  // legs, junctions, post/board colors). Every change to either pushes a
  // new snapshot, except when the change came FROM undo/redo itself
  // (isUndoRedoRef guards against re-recording that as a new step).
  const [history, setHistory] = useState<{
    entries: { shape: Shape; colorScheme: ColorScheme; profileScheme: ProfileScheme }[];
    index: number;
  }>(() => ({ entries: [{ shape, colorScheme, profileScheme }], index: 0 }));
  const isUndoRedoRef = useRef(false);

  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    setHistory((h) => {
      const truncated = h.entries.slice(0, h.index + 1);
      return { entries: [...truncated, { shape, colorScheme, profileScheme }], index: truncated.length };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, colorScheme, profileScheme]);

  function undo() {
    if (history.index <= 0) return;
    const newIndex = history.index - 1;
    isUndoRedoRef.current = true;
    setShape(history.entries[newIndex].shape);
    setColorScheme(history.entries[newIndex].colorScheme);
    setProfileScheme(history.entries[newIndex].profileScheme);
    setHistory((h) => ({ ...h, index: newIndex }));
  }
  function redo() {
    if (history.index >= history.entries.length - 1) return;
    const newIndex = history.index + 1;
    isUndoRedoRef.current = true;
    setShape(history.entries[newIndex].shape);
    setColorScheme(history.entries[newIndex].colorScheme);
    setProfileScheme(history.entries[newIndex].profileScheme);
    setHistory((h) => ({ ...h, index: newIndex }));
  }
  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    dragStartRef.current = { startY: e.clientY, startHeight: sheetHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    // Sheet is anchored to the bottom, so dragging DOWN (positive delta) shrinks it.
    const delta = e.clientY - dragStartRef.current.startY;
    const next = Math.min(480, Math.max(56, dragStartRef.current.startHeight - delta));
    setSheetHeight(next);
  }
  function handleDragEnd() {
    dragStartRef.current = null;
  }
  const [stats, setStats] = useState({
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    boardCount: 0,
    postCount: 0,
    doublePostCount: 0,
    fieldCount: 0,
  });

  function updateLeg(legIndex: number, updater: (leg: Leg) => Leg) {
    setShape((prev) => ({
      ...prev,
      legs: prev.legs.map((leg, i) => (i === legIndex ? updater(leg) : leg)),
    }));
  }

  // Which of this leg's own two ends is a shared "middle" post (boards
  // emerge from both faces — a straight/left/right junction to a
  // neighboring leg) vs. a true "end" post (one face only — either edge of
  // the whole shape, or either side of a 'disconnect') decides its segment
  // margin in the real field-count formula. Same split shape.ts's
  // layoutShape already uses to decide isDoublePost.
  function fieldCountForLegAt(legIndex: number, lengthM: number): number {
    const startIsMiddle = legIndex > 0 && shape.junctions[legIndex - 1]?.type !== 'disconnect';
    const endIsMiddle = legIndex < shape.legs.length - 1 && shape.junctions[legIndex]?.type !== 'disconnect';
    return fieldCountForLeg(lengthM, startIsMiddle, endIsMiddle);
  }

  // Length is the only leg input that changes how many fields the leg
  // splits into — when it grows past a split point, every NEW field starts
  // as a copy of the previous last field's pattern (confirmed behavior).
  function updateLegLength(legIndex: number, newLengthM: number) {
    const oldCount = fieldCountForLegAt(legIndex, shape.legs[legIndex].lengthM);
    const newCount = fieldCountForLegAt(legIndex, newLengthM);
    updateLeg(legIndex, (l) => ({ ...l, lengthM: newLengthM }));
    if (newCount > oldCount) {
      const newIndexes: number[] = [];
      for (let f = oldCount; f < newCount; f++) newIndexes.push(f);
      cloneFieldProfileRules(legIndex, oldCount - 1, legIndex, newIndexes);
    }
  }

  function setJunction(junctionIndex: number, type: Junction['type']) {
    setShape((prev) => ({
      ...prev,
      junctions: prev.junctions.map((j, i) => (i === junctionIndex ? { type } : j)),
    }));
  }

  function addLeg() {
    const lastLegIndex = shape.legs.length - 1;
    const lastLeg = shape.legs[lastLegIndex];
    const lastFieldIndex = fieldCountForLegAt(lastLegIndex, lastLeg.lengthM) - 1;
    setShape((prev) => {
      const last = prev.legs[prev.legs.length - 1];
      return {
        legs: [
          ...prev.legs,
          {
            lengthM: 3,
            baseHeightCm: last.baseHeightCm,
            heightCm: last.heightCm,
            modelId: last.modelId,
            sizeId: last.sizeId,
            wallWidthCm: last.wallWidthCm,
          },
        ],
        junctions: [...prev.junctions, { type: 'straight' }],
      };
    });
    // New leg = continuation of the shape: its fields inherit the pattern
    // of the field they extend from (the previous leg's last field). The
    // new leg's own start is a middle post (it's about to be joined to
    // lastLeg by a 'straight' junction above) and its end is a true shape
    // end (nothing after it yet) — can't use fieldCountForLegAt here since
    // this leg doesn't exist in `shape` yet.
    const newLegFieldCount = fieldCountForLeg(3, true, false);
    const newIndexes: number[] = [];
    for (let f = 0; f < newLegFieldCount; f++) newIndexes.push(f);
    cloneFieldProfileRules(lastLegIndex, lastFieldIndex, lastLegIndex + 1, newIndexes);
    // Accordion, not a pile-up: closes whatever was open and opens only
    // the leg just added, so the panel never shows more than one
    // expanded leg at a time — keeps the order readable as the shape
    // grows instead of leaving every past leg expanded underneath.
    setExpandedLegIndices(new Set([lastLegIndex + 1]));
  }

  function removeLastLeg() {
    const removedIndex = shape.legs.length - 1;
    setShape((prev) => {
      if (prev.legs.length <= 1) return prev;
      return { legs: prev.legs.slice(0, -1), junctions: prev.junctions.slice(0, -1) };
    });
    setExpandedLegIndices((prev) => {
      if (!prev.has(removedIndex)) return prev;
      const next = new Set(prev);
      next.delete(removedIndex);
      return next;
    });
  }

  // Clicking an open leg's header collapses it back to the summary line, no
  // camera change. Clicking a closed leg's header opens it AND flies the
  // camera to frame that whole leg.
  function toggleLeg(legIndex: number) {
    const wasOpen = expandedLegIndices.has(legIndex);
    setExpandedLegIndices((prev) => {
      const next = new Set(prev);
      if (wasOpen) next.delete(legIndex);
      else next.add(legIndex);
      return next;
    });
    if (!wasOpen) {
      legFocusNonceRef.current += 1;
      setLegCameraFocus({ legIndex, nonce: legFocusNonceRef.current });
    }
  }

  function setPostColor(hex: string) {
    setColorScheme((prev) => ({ ...prev, postColorHex: hex }));
  }

  // Appends one rule — later rules override earlier ones for any board
  // both match, so "last action wins" just falls out of insertion order.
  // scope follows the "apply to all fields" toggle: field-scoped by
  // default (just the column between the 2 posts you clicked in), global
  // only when explicitly asked for.
  function addColorRule(direction: 'exact' | 'below' | 'above', heightCm: number, colorHex: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setColorScheme((prev) => ({
      ...prev,
      boardRules: [
        ...prev.boardRules,
        applyToAllFields
          ? { heightCm, colorHex, direction, scope: 'global' as const }
          : { heightCm, colorHex, direction, scope: 'field' as const, legIndex, fieldIndex },
      ],
    }));
  }

  // Paints every step in a multi-selection at once, one rule per step (each
  // keyed by ITS OWN height — color is height-keyed, and mixed-profile steps
  // don't share a height, so the anchor's height alone isn't enough here).
  function addColorRuleForSteps(stepIndices: number[], colorHex: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setColorScheme((prev) => ({
      ...prev,
      boardRules: [
        ...prev.boardRules,
        ...stepIndices.map((stepIndex) => {
          const heightCm = selection.stepHeights[stepIndex] ?? selection.heightCm;
          return applyToAllFields
            ? { heightCm, colorHex, direction: 'exact' as const, scope: 'global' as const }
            : { heightCm, colorHex, direction: 'exact' as const, scope: 'field' as const, legIndex, fieldIndex };
        }),
      ],
    }));
  }

  // Clicking a swatch paints the whole current selection immediately — a
  // single step by default, every step in a range/multi-selection when one
  // is active. below/above are follow-up actions to extend from the edges
  // of that selection, not required first steps.
  function pickBoardColor(hex: string) {
    setPendingBoardColor(hex);
    if (selection?.kind === 'board') {
      addColorRuleForSteps(selection.stepIndices, hex);
    }
  }

  // Same shape as addColorRule, one rule type over — but keyed on STEP
  // INDEX, not height (height circularly depends on the types being
  // resolved; index is just the stacking counter). Field-scoped by default,
  // global only when "apply to all fields" is on, later rules win.
  function addProfileRule(direction: 'exact' | 'below' | 'above', stepIndex: number, modelId: string, sizeId: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      rules: [
        ...prev.rules,
        applyToAllFields
          ? { stepIndex, modelId, sizeId, direction, scope: 'global' as const }
          : { stepIndex, modelId, sizeId, direction, scope: 'field' as const, legIndex, fieldIndex },
      ],
    }));
  }

  // Same idea as addColorRuleForSteps: one 'exact' rule per selected step —
  // trivial here since profile is index-keyed, no per-step lookup needed.
  function addProfileRuleForSteps(stepIndices: number[], modelId: string, sizeId: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      rules: [
        ...prev.rules,
        ...stepIndices.map((stepIndex) =>
          applyToAllFields
            ? { stepIndex, modelId, sizeId, direction: 'exact' as const, scope: 'global' as const }
            : { stepIndex, modelId, sizeId, direction: 'exact' as const, scope: 'field' as const, legIndex, fieldIndex },
        ),
      ],
    }));
  }

  // A newly created field starts as a continuation of its neighbor: copy
  // every field-scoped profile rule from the source field onto each new
  // field index. Confirmed behavior — "design one field, then extend and
  // the design travels with you", which the interactive tutorial will lean
  // on as the intended flow.
  function cloneFieldProfileRules(
    fromLegIndex: number,
    fromFieldIndex: number,
    toLegIndex: number,
    toFieldIndexes: number[],
  ) {
    if (toFieldIndexes.length === 0) return;
    setProfileScheme((prev) => {
      const sourceRules = prev.rules.filter(
        (r) => r.scope === 'field' && r.legIndex === fromLegIndex && r.fieldIndex === fromFieldIndex,
      );
      const sourceSpacers = prev.spacerRules.filter(
        (r) => r.scope === 'field' && r.legIndex === fromLegIndex && r.fieldIndex === fromFieldIndex,
      );
      if (sourceRules.length === 0 && sourceSpacers.length === 0) return prev;
      const clonedRules = toFieldIndexes.flatMap((fieldIndex) =>
        sourceRules.map((r) => ({ ...r, legIndex: toLegIndex, fieldIndex })),
      );
      const clonedSpacers = toFieldIndexes.flatMap((fieldIndex) =>
        sourceSpacers.map((r) => ({ ...r, legIndex: toLegIndex, fieldIndex })),
      );
      return { ...prev, rules: [...prev.rules, ...clonedRules], spacerRules: [...prev.spacerRules, ...clonedSpacers] };
    });
  }

  // Spacer sizing (advanced): a multiplier on the spacer BELOW a step,
  // through the exact same rule machinery — immediate on the clicked step,
  // below/above as follow-ups, same "apply to all fields" scope.
  function addSpacerRule(direction: 'exact' | 'below' | 'above', stepIndex: number, multiplier: number) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      spacerRules: [
        ...prev.spacerRules,
        applyToAllFields
          ? { stepIndex, multiplier, direction, scope: 'global' as const }
          : { stepIndex, multiplier, direction, scope: 'field' as const, legIndex, fieldIndex },
      ],
    }));
  }

  function addSpacerRuleForSteps(stepIndices: number[], multiplier: number) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      spacerRules: [
        ...prev.spacerRules,
        ...stepIndices.map((stepIndex) =>
          applyToAllFields
            ? { stepIndex, multiplier, direction: 'exact' as const, scope: 'global' as const }
            : { stepIndex, multiplier, direction: 'exact' as const, scope: 'field' as const, legIndex, fieldIndex },
        ),
      ],
    }));
  }

  function pickSpacer(multiplier: number) {
    setPendingSpacer(multiplier);
    if (selection?.kind === 'board') {
      addSpacerRuleForSteps(selection.stepIndices, multiplier);
    }
  }

  // Picking a model resets to that model's first size — same reasoning as
  // the leg-level "סוג"/"גודל" carousels: a size only makes sense for the
  // model it belongs to.
  function pickBoardProfile(modelId: string, sizeId: string) {
    setPendingModelId(modelId);
    setPendingSizeId(sizeId);
    if (selection?.kind === 'board') {
      addProfileRuleForSteps(selection.stepIndices, modelId, sizeId);
    }
  }

  // Explicit escape hatch: a field with ANY field-scoped profile rule stays
  // deaf to the leg's own bootstrap default (no longer user-facing, but
  // still resolveBoardProfile's fallback) for whatever height range that
  // rule covers — even if you've since repainted every step back to the
  // same type, since that's still explicit rules, not "no rules".
  // Repainting to look uniform again doesn't undo that; this does, on
  // purpose, rather than guessing from the resolved colors/types whether a
  // field "counts" as still customized.
  function clearFieldProfile(legIndex: number, fieldIndex: number) {
    setProfileScheme((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => !(r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex)),
      spacerRules: prev.spacerRules.filter(
        (r) => !(r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex),
      ),
    }));
  }

  function showApplyFenceToast() {
    const showHint = !hasShownApplyFenceHint;
    if (showHint) setHasShownApplyFenceHint(true);
    setApplyFenceToast({ showHint });
    if (applyFenceToastTimeoutRef.current) window.clearTimeout(applyFenceToastTimeoutRef.current);
    applyFenceToastTimeoutRef.current = window.setTimeout(() => setApplyFenceToast(null), 6000);

    setUndoPulse(true);
    if (undoPulseTimeoutRef.current) window.clearTimeout(undoPulseTimeoutRef.current);
    undoPulseTimeoutRef.current = window.setTimeout(() => setUndoPulse(false), 700);
  }

  function undoApplyFenceToast() {
    undo();
    setApplyFenceToast(null);
    if (applyFenceToastTimeoutRef.current) window.clearTimeout(applyFenceToastTimeoutRef.current);
  }

  // "החל על כל הגדר": copies the SINGLE field currently open in the sheet —
  // every one of its steps' color, profile and spacer — one-to-one by step
  // index, onto every OTHER field in the project. Independent of each
  // attribute's own "החל על כל השדות" checkbox. Never touches any leg's own
  // length/height. A taller/shorter target field just fills/stops per the
  // normal computeBoardStack rule (closest whole board, no cutting) — steps
  // beyond what the source had simply aren't written, so they fall back to
  // that leg's own default the same as any untouched field.
  //
  // Color rules are height-keyed (not step-index-keyed — see BoardColorRule
  // in Scene.tsx), so "by step index" for color means: resolve the source's
  // color at each step, then re-key it to whatever absolute height that same
  // step lands at in the TARGET field. A step's height-from-post-base only
  // depends on the stack of board/spacer dims below it — which is now
  // identical across every target too, since we're writing the same profile
  // rules everywhere — so the source's own board.centerCm can be reused
  // directly; only the target leg's own baseHeightCm differs.
  function applyFieldToEntireFence() {
    if (selection?.kind !== 'board') return;
    const { legIndex: sourceLegIndex, fieldIndex: sourceFieldIndex } = selection;
    const sourceLeg = shape.legs[sourceLegIndex];
    const sourceFillHeightCm = sourceLeg.heightCm - sourceLeg.baseHeightCm;

    const sourceStack = computeBoardStack(sourceFillHeightCm, (stepIndex) =>
      resolveBoardStepCandidates(profileScheme, sourceLegIndex, sourceFieldIndex, stepIndex, sourceLeg.modelId, sourceLeg.sizeId),
    );

    if (sourceStack.boards.length === 0) return;

    const newProfileRules: BoardProfileRule[] = [];
    const newSpacerRules: SpacerRule[] = [];
    const newColorRules: BoardColorRule[] = [];

    shape.legs.forEach((targetLeg, targetLegIndex) => {
      const targetFieldCount = fieldCountForLegAt(targetLegIndex, targetLeg.lengthM);
      for (let targetFieldIndex = 0; targetFieldIndex < targetFieldCount; targetFieldIndex++) {
        if (targetLegIndex === sourceLegIndex && targetFieldIndex === sourceFieldIndex) continue;
        for (const board of sourceStack.boards) {
          newProfileRules.push({
            stepIndex: board.stepIndex,
            modelId: board.modelId,
            sizeId: board.sizeId,
            direction: 'exact',
            scope: 'field',
            legIndex: targetLegIndex,
            fieldIndex: targetFieldIndex,
          });
          newSpacerRules.push({
            stepIndex: board.stepIndex,
            multiplier: resolveSpacerMultiplier(profileScheme, sourceLegIndex, sourceFieldIndex, board.stepIndex),
            direction: 'exact',
            scope: 'field',
            legIndex: targetLegIndex,
            fieldIndex: targetFieldIndex,
          });
          const sourceAbsHeightCm = sourceLeg.baseHeightCm + board.centerCm;
          const colorHex = resolveBoardColorHex(colorScheme, sourceLegIndex, sourceFieldIndex, sourceAbsHeightCm);
          const targetAbsHeightCm = targetLeg.baseHeightCm + board.centerCm;
          newColorRules.push({
            heightCm: targetAbsHeightCm,
            colorHex,
            direction: 'exact',
            scope: 'field',
            legIndex: targetLegIndex,
            fieldIndex: targetFieldIndex,
          });
        }
      }
    });

    setProfileScheme((prev) => ({
      ...prev,
      rules: [...prev.rules, ...newProfileRules],
      spacerRules: [...prev.spacerRules, ...newSpacerRules],
    }));
    setColorScheme((prev) => ({ ...prev, boardRules: [...prev.boardRules, ...newColorRules] }));

    showApplyFenceToast();
  }

  // Seed the pickers with the CLICKED board's actual current color, profile
  // and spacer, instead of leaving whatever was last picked for a different
  // board — that staleness was its own source of "why did it apply the
  // wrong thing". Profile falls back to the leg's own model/size, same
  // fallback resolveBoardProfile itself uses when no rule matches yet.
  useEffect(() => {
    if (selection?.kind === 'board') {
      setPendingBoardColor(resolveBoardColorHex(colorScheme, selection.legIndex, selection.fieldIndex, selection.heightCm));
      const leg = shape.legs[selection.legIndex];
      const resolved = resolveBoardProfile(
        profileScheme,
        selection.legIndex,
        selection.fieldIndex,
        selection.stepIndex,
        leg.modelId,
        leg.sizeId,
      );
      setPendingModelId(resolved.modelId);
      setPendingSizeId(resolved.sizeId);
      setPendingSpacer(
        resolveSpacerMultiplier(profileScheme, selection.legIndex, selection.fieldIndex, selection.stepIndex),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

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

  return (
    <div className="app">
      <div className="scene-area">
        <div className="scene-canvas-wrap">
          <Scene
            shape={shape}
            colorScheme={colorScheme}
            profileScheme={profileScheme}
            selection={selection}
            onSelect={(nextSelection) => {
              setSelection(nextSelection);
            }}
            onStats={setStats}
            skipNextFocusRef={skipNextFocusRef}
            legCameraFocus={legCameraFocus}
          />
          <div className="stats-badge">
            <div>{stats.fps} FPS</div>
            <div>{stats.drawCalls} draw calls</div>
            <div>{stats.triangles.toLocaleString()} triangles</div>
          </div>

          <div className="history-controls">
            <button
              className={undoPulse ? 'history-btn history-btn-pulse' : 'history-btn'}
              onClick={undo}
              disabled={!canUndo}
              title="בטל (Ctrl+Z)"
            >
              ↶
            </button>
            <button className="history-btn" onClick={redo} disabled={!canRedo} title="בצע שוב (Ctrl+Y)">
              ↷
            </button>
          </div>

          {applyFenceToast && (
            <div className="toast">
              <span className="toast-message">העיצוב של השדה הוחל על כל הגדר</span>
              <button className="toast-undo" onClick={undoApplyFenceToast}>
                בטל ↺
              </button>
              {applyFenceToast.showHint && <div className="toast-hint">תמיד אפשר לבטל שינויים גדולים</div>}
            </div>
          )}
        </div>

        {selection?.kind === 'post' && (
          <div className="bottom-sheet" style={{ height: sheetHeight }}>
            <div
              className="sheet-handle"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              <div className="sheet-handle-bar" />
            </div>
            <div className="bottom-sheet-header">
              <span>עמוד נבחר — צובע את כל העמודים בגדר</span>
              <button className="text-btn" onClick={() => setSelection(null)}>
                סגור ✕
              </button>
            </div>
            <div className="bottom-sheet-content">
              <div className="carousel-row">
                <span className="carousel-label">צבע עמודים</span>
                <div className="carousel">
                  {FENCE_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      className={colorScheme.postColorHex === c.hex ? 'swatch active' : 'swatch'}
                      style={{ background: c.hex }}
                      title={c.name}
                      onClick={() => setPostColor(c.hex)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {selection?.kind === 'board' && (
          <div className="bottom-sheet" style={{ height: sheetHeight }}>
            <div
              className="sheet-handle"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              <div className="sheet-handle-bar" />
            </div>
            <div className="bottom-sheet-header">
              <span>
                {selection.stepIndices.length > 1
                  ? `עריכת שלבים — ${selection.stepIndices.length} שלבים נבחרו`
                  : `שלב ${selection.stepIndex + 1} — בגובה ${Math.round(selection.heightCm)} ס״מ`}{' '}
                (רגל {selection.legIndex + 1}, שדה{' '}
                {selection.fieldIndex + 1})
              </span>
              <button className="text-btn" onClick={() => setSelection(null)}>
                סגור ✕
              </button>
            </div>
            <div className="bottom-sheet-content">
              <div className="sheet-flow">

                <div className="carousel-row">
                  <div className="carousel-label-row">
                    <span className="carousel-label">פרופיל השלב הזה — לחיצה קובעת מיד רק אותו</span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <label className="group-toggle">
                        <input
                          type="checkbox"
                          checked={applyToAllFields}
                          onChange={(e) => setApplyToAllFields(e.target.checked)}
                        />
                        החל על כל השדות
                      </label>

                      <button
                        type="button"
                        className="text-btn"
                        disabled={
                          !(
                            profileScheme.rules.some(
                              (r) =>
                                r.scope === 'field' &&
                                r.legIndex === selection.legIndex &&
                                r.fieldIndex === selection.fieldIndex,
                            ) ||
                            profileScheme.spacerRules.some(
                              (r) =>
                                r.scope === 'field' &&
                                r.legIndex === selection.legIndex &&
                                r.fieldIndex === selection.fieldIndex,
                            )
                          )
                        }
                        onClick={() => clearFieldProfile(selection.legIndex, selection.fieldIndex)}
                        style={{
                          opacity:
                            profileScheme.rules.some(
                              (r) =>
                                r.scope === 'field' &&
                                r.legIndex === selection.legIndex &&
                                r.fieldIndex === selection.fieldIndex,
                            ) ||
                              profileScheme.spacerRules.some(
                                (r) =>
                                  r.scope === 'field' &&
                                  r.legIndex === selection.legIndex &&
                                  r.fieldIndex === selection.fieldIndex,
                              )
                              ? 1
                              : 0.45,
                          cursor:
                            profileScheme.rules.some(
                              (r) =>
                                r.scope === 'field' &&
                                r.legIndex === selection.legIndex &&
                                r.fieldIndex === selection.fieldIndex,
                            ) ||
                              profileScheme.spacerRules.some(
                                (r) =>
                                  r.scope === 'field' &&
                                  r.legIndex === selection.legIndex &&
                                  r.fieldIndex === selection.fieldIndex,
                              )
                              ? 'pointer'
                              : 'default',
                        }}
                      >
                        שחזר ברירת מחדל ↺
                      </button>
                    </div>
                  </div>
                  <div className="carousel">
                    {FENCE_CATALOG.map((model, i) => (
                      <button
                        key={model.id}
                        className={pendingModelId === model.id ? 'carousel-item active' : 'carousel-item'}
                        onClick={() => pickBoardProfile(model.id, model.sizes[0].id)}
                      >
                        {model.name ?? `סוג ${i + 1}`}
                      </button>
                    ))}
                  </div>
                  <div className="carousel" style={{ marginTop: 6 }}>
                    {(FENCE_CATALOG.find((m) => m.id === pendingModelId) ?? FENCE_CATALOG[0]).sizes.map((size) => (
                      <button
                        key={size.id}
                        className={pendingSizeId === size.id ? 'carousel-item active' : 'carousel-item'}
                        onClick={() => pickBoardProfile(pendingModelId, size.id)}
                      >
                        {size.name ?? `${size.boardHeightCm}/${size.spacerHeightCm} ס״מ`}
                      </button>
                    ))}
                  </div>
                  <div className="split-actions">
                    <button
                      className="text-btn"
                      onClick={() =>
                        addProfileRule('below', Math.min(...selection.stepIndices), pendingModelId, pendingSizeId)
                      }
                    >
                      מהשלב הזה ומטה ↓
                    </button>
                    <button
                      className="text-btn"
                      onClick={() =>
                        addProfileRule('above', Math.max(...selection.stepIndices), pendingModelId, pendingSizeId)
                      }
                    >
                      מהשלב הזה ומעלה ↑
                    </button>
                  </div>
                </div>
                <div className="carousel-row">
                  <span className="carousel-label">רווח מתחת לשלב הזה — לחיצה קובעת מיד רק אותו</span>
                  <div className="carousel">
                    {[
                      { label: 'חצי', value: 0.5 },
                      { label: 'רגיל', value: 1 },
                      { label: 'כפול', value: 2 },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        className={pendingSpacer === opt.value ? 'carousel-item active' : 'carousel-item'}
                        onClick={() => pickSpacer(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="split-actions">
                    <button
                      className="text-btn"
                      onClick={() => addSpacerRule('below', Math.min(...selection.stepIndices), pendingSpacer)}
                    >
                      מהשלב הזה ומטה ↓
                    </button>
                    <button
                      className="text-btn"
                      onClick={() => addSpacerRule('above', Math.max(...selection.stepIndices), pendingSpacer)}
                    >
                      מהשלב הזה ומעלה ↑
                    </button>
                  </div>
                </div>

                <div className="carousel-row">
                  <div className="carousel-label-row">
                    <span className="carousel-label">צבע — לחיצה צובעת מיד רק את השלב הזה</span>
                    <label className="group-toggle">
                      <input
                        type="checkbox"
                        checked={applyToAllFields}
                        onChange={(e) => setApplyToAllFields(e.target.checked)}
                      />
                      החל על כל השדות
                    </label>
                  </div>
                  <div className="carousel">
                    {FENCE_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        className={pendingBoardColor === c.hex ? 'swatch active' : 'swatch'}
                        style={{ background: c.hex }}
                        title={c.name}
                        onClick={() => pickBoardColor(c.hex)}
                      />
                    ))}
                  </div>
                  <div className="split-actions">
                    <button
                      className="text-btn"
                      onClick={() =>
                        addColorRule(
                          'below',
                          selection.stepHeights[Math.min(...selection.stepIndices)] ?? selection.heightCm,
                          pendingBoardColor,
                        )
                      }
                    >
                      מהשלב הזה ומטה ↓
                    </button>
                    <button
                      className="text-btn"
                      onClick={() =>
                        addColorRule(
                          'above',
                          selection.stepHeights[Math.max(...selection.stepIndices)] ?? selection.heightCm,
                          pendingBoardColor,
                        )
                      }
                    >
                      מהשלב הזה ומעלה ↑
                    </button>
                  </div>
                </div>

                <div className="field-actions">
                  <button type="button" className="apply-fence-btn" onClick={applyFieldToEntireFence}>
                    החל שדה זה על כל הגדר
                  </button>

                  <button
                    type="button"
                    className="text-btn"
                    disabled={
                      !(
                        profileScheme.rules.some(
                          (r) =>
                            r.scope === 'field' &&
                            r.legIndex === selection.legIndex &&
                            r.fieldIndex === selection.fieldIndex,
                        ) ||
                        profileScheme.spacerRules.some(
                          (r) =>
                            r.scope === 'field' &&
                            r.legIndex === selection.legIndex &&
                            r.fieldIndex === selection.fieldIndex,
                        )
                      )
                    }
                    onClick={() => clearFieldProfile(selection.legIndex, selection.fieldIndex)}
                  >
                    שחזר ברירת מחדל ↺
                  </button>
                </div>

              </div>

            </div>
          </div>
        )}
      </div>

      <div
        className={selection ? 'panel panel-yield-mobile' : 'panel'}
        style={{ '--panel-mobile-height': `${sheetHeight}px` } as React.CSSProperties}
      >
        <div
          className="panel-mobile-handle"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div className="sheet-handle-bar" />
        </div>
        <div className="panel-mobile-header">
          <button className="text-btn" onClick={() => setSheetHeight((h) => (h <= 60 ? 320 : 56))}>
            {sheetHeight <= 60 ? 'פתח ⌃' : 'כווץ ✕'}
          </button>
        </div>
        <div className="panel-scroll">
          <h1>בילדר צורה — גדר פרוצדורלית</h1>
          <p className="hint">
            רגל היא היחידה הבסיסית — לכל רגל גובה חומה קיים וגובה סגירה משלה. הצומת בין כל שתי
            רגליים קובע הכל: 90° (ימינה/שמאלה), ישר (רק שינוי גובה), או נתק (שתי גדרות נפרדות
            לגמרי, בלי עמוד משותף). לחיצה על עמוד בסצנה קובעת צבע לכל העמודים; לחיצה על שלב
            פותחת בחירת צבע מפוצלת לפי גובה.
          </p>

          {shape.legs.map((leg, legIndex) => {
            const isOpen = expandedLegIndices.has(legIndex);
            return (
              <div key={legIndex} ref={(el) => { legRefs.current[legIndex] = el; }}>
                <div className="segment-block">
                  <button
                    type="button"
                    className="segment-header segment-header-toggle"
                    onClick={() => toggleLeg(legIndex)}
                  >
                    <span>מקטע {legIndex + 1}</span>
                    {!isOpen && (
                      <span className="segment-summary">
                        אורך {leg.lengthM.toFixed(1)} מ׳ · גובה  {Math.round(leg.heightCm)} ס״מ
                      </span>
                    )}
                    <span className={isOpen ? 'segment-caret segment-caret-open' : 'segment-caret'}>
                      {isOpen ? '↑' : '↓'}
                    </span>
                  </button>

                  {isOpen && (
                    <>
                      <PrecisionSlider
                        mode="length"
                        className="leg-row"
                        label="אורך"
                        min={0}
                        max={20}
                        step={1}
                        value={leg.lengthM}
                        fineValue={getPrecision(lengthPrecision, legIndex).fine}
                        precisionOn={getPrecision(lengthPrecision, legIndex).on}
                        onChangeValue={(v) => updateLegLength(legIndex, v)}
                        onChangeFineValue={(f) =>
                          setLengthPrecision((prev) => ({ ...prev, [legIndex]: { ...getPrecision(prev, legIndex), fine: f } }))
                        }
                        onTogglePrecision={(on) =>
                          setLengthPrecision((prev) => ({ ...prev, [legIndex]: { ...getPrecision(prev, legIndex), on } }))
                        }
                        onFineAdjust={() => {
                          skipNextFocusRef.current = true;
                        }}
                      />

                      <PrecisionSlider
                        mode="height"
                        className="leg-row base-height-row"
                        label="גובה חומה קיים"
                        min={0}
                        max={Math.max(0, leg.heightCm - 20)}
                        step={1}
                        value={leg.baseHeightCm}
                        fineValue={getPrecision(baseHeightPrecision, legIndex).fine}
                        precisionOn={getPrecision(baseHeightPrecision, legIndex).on}
                        onChangeValue={(v) => updateLeg(legIndex, (l) => ({ ...l, baseHeightCm: v }))}
                        onChangeFineValue={(f) =>
                          setBaseHeightPrecision((prev) => ({
                            ...prev,
                            [legIndex]: { ...getPrecision(prev, legIndex), fine: f },
                          }))
                        }
                        onTogglePrecision={(on) =>
                          setBaseHeightPrecision((prev) => ({ ...prev, [legIndex]: { ...getPrecision(prev, legIndex), on } }))
                        }
                        onFineAdjust={() => {
                          skipNextFocusRef.current = true;
                        }}
                      />

                      {getPrecision(baseHeightPrecision, legIndex).on && leg.baseHeightCm > 0 && (
                        <div className="leg-row">
                          <span className="value-trigger">רוחב חומה: {formatTrimmed(leg.wallWidthCm, 1)} ס״מ</span>
                          <input
                            type="range"
                            min={POST_THICKNESS_CM * POST_ACCESSORY_WIDTH_MULTIPLIER} // can't be narrower than the rosette sitting on top of it
                            max={Math.max(40, POST_THICKNESS_CM * POST_ACCESSORY_WIDTH_MULTIPLIER * 2)} // placeholder ceiling — ask the client for a real range
                            step={0.5}
                            value={leg.wallWidthCm}
                            onChange={(e) => updateLeg(legIndex, (l) => ({ ...l, wallWidthCm: Number(e.target.value) }))}
                          />
                        </div>
                      )}

                      <HeightSnapSlider
                        label="גובה גדר"
                        leg={leg}
                        boardHeightCm={resolveBoardDims(leg.modelId, leg.sizeId).boardHeightCm}
                        spacerHeightCm={resolveBoardDims(leg.modelId, leg.sizeId).spacerHeightCm}
                        onChangeHeight={(v) => updateLeg(legIndex, (l) => ({ ...l, heightCm: v }))}
                      />
                    </>
                  )}
                </div>

                {shape.junctions[legIndex] && (
                  <div className="junction-divider">
                    <div className="junction-controls">
                      {(['right', 'left', 'straight', 'disconnect'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={
                            shape.junctions[legIndex].type === t
                              ? 'pill active'
                              : 'pill'
                          }
                          onClick={() => setJunction(legIndex, t)}
                        >
                          {JUNCTION_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="segment-actions">
            <button className="text-btn" onClick={addLeg}>
              + הוסף רגל
            </button>
            {shape.legs.length > 1 && (
              <button className="text-btn" onClick={removeLastLeg}>
                − הסר רגל אחרונה
              </button>
            )}
          </div>

          <div className="summary">
            <div>
              <span>שלבים</span>
              <strong>{stats.boardCount}</strong>
              <span>(פרופילים)</span>
            </div>
            <div>
              <span>עמודים</span>
              <strong>{stats.postCount}</strong>
              <span>({stats.doublePostCount} כפולים)</span>
            </div>
            <div>
              <span>שדות</span>
              <strong>{stats.fieldCount}</strong>
            </div>
          </div>

          <p className="footnote">מידות עמוד, עובי לוח ועומק חריץ עדיין PLACEHOLDER — ראה constants.ts.</p>
        </div>
      </div>
    </div>
  );
}
