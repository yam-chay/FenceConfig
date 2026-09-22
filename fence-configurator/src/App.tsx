import { useEffect, useRef, useState } from 'react';
import { SPACER_OPTIONS } from './scene/spacerOptions';
import Scene, { type ColorScheme, type ProfileScheme, type Selection } from './scene/Scene';
import type { Shape, Junction } from './geometry/shape';
import { FENCE_CATALOG } from './geometry/catalog';
import { POST_THICKNESS_CM, POST_ACCESSORY_WIDTH_MULTIPLIER } from './geometry/constants';
import { FENCE_COLORS, defaultShape, defaultColorScheme, defaultProfileScheme } from './app/defaults';
import { formatTrimmed } from './app/utils/numberUtils';
import { PrecisionSlider } from './app/components/PrecisionSlider';
import { HeightSnapSlider } from './app/components/HeightSnapSlider';
import { CircularTimeSlider } from './app/components/CircularTimeSlider';
import { useHistory } from './app/hooks/useHistory';
import { usePanelState } from './app/hooks/usePanelState';
import { useFenceEditor } from './app/hooks/useFenceEditor';
import {
  readInitialDesign,
  makeSnapshot,
  saveLocalDesign,
  isViewHash,
  buildShareUrl,
  type DesignSnapshot,
  type InitialDesign,
} from './app/persistence';
import { DesignErrorBoundary, CenteredNotice } from './app/components/DesignErrorBoundary';
import { ViewDisclaimer } from './app/components/ViewDisclaimer';
import { ShareLinkButton } from './app/components/ShareLinkButton';
import './App.css';

const JUNCTION_LABELS: Record<Junction['type'], string> = {
  right: 'שמאלה',
  left: 'ימינה',
  straight: 'ישר',
  disconnect: 'נתק',
};

/** Autosave debounce — a slider drag fires many updates per second. */
const AUTOSAVE_DELAY_MS = 300;

// Build identity for bug reports. Vercel exposes its system env vars to Vite
// with a VITE_ prefix at build time; locally they're undefined.
const BUILD_SHA = (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined)?.slice(0, 7) ?? 'local';
const BUILD_ENV = (import.meta.env.VITE_VERCEL_ENV as string | undefined) ?? 'development';
const BUILD_BRANCH = (import.meta.env.VITE_VERCEL_GIT_COMMIT_REF as string | undefined) ?? '';
const BUG_TOAST_MS = 3500;

/** Hebrew count: "מקטע אחד" / "3 מקטעים" (all nouns used here are masculine). */
function count(n: number, one: string, many: string): string {
  return n === 1 ? `${one} אחד` : `${n} ${many}`;
}

function describeSelection(selection: Selection | null): string {
  if (!selection) return 'אין';
  if (selection.kind === 'post') return 'עמוד';
  const steps = selection.stepIndices.map((i) => i + 1).join(', ');
  const stepsLabel = selection.stepIndices.length === 1 ? 'שלב' : 'שלבים';
  return `מקטע ${selection.legIndex + 1}, שדה ${selection.fieldIndex + 1}, ${stepsLabel} ${steps}`;
}

/** Plain text, built to be pasted into WhatsApp/Slack as-is. */
function buildBugReport(args: {
  description: string;
  snapshot: DesignSnapshot;
  selection: Selection | null;
  stats: { fps: number; drawCalls: number; triangles: number; boardCount: number; postCount: number; fieldCount: number };
}): string {
  const { description, snapshot, selection, stats } = args;
  const version = [BUILD_SHA, BUILD_ENV, BUILD_BRANCH].filter(Boolean).join(' · ');
  return [
    '🐞 דיווח באג',
    `מה קרה: ${description || '(לא צוין)'}`,
    '',
    `קישור למצב הגדר: ${buildShareUrl(snapshot)}`,
    '',
    `גרסה: ${version}`,
    `זמן: ${new Date().toLocaleString('he-IL')}`,
    `מסך: ${window.screen.width}×${window.screen.height} · DPR ${window.devicePixelRatio} · חלון ${window.innerWidth}×${window.innerHeight}`,
    `דפדפן: ${navigator.userAgent}`,
    `בחירה: ${describeSelection(selection)}`,
    `ביצועים: ${stats.fps} FPS · ${stats.drawCalls} draw calls · ${stats.triangles.toLocaleString()} triangles`,
    `גדר: ${[
      count(snapshot.shape.legs.length, 'מקטע', 'מקטעים'),
      count(stats.fieldCount, 'שדה', 'שדות'),
      count(stats.boardCount, 'שלב', 'שלבים'),
      count(stats.postCount, 'עמוד', 'עמודים'),
    ].join(' · ')}`,
  ].join('\n');
}

function FenceApp({ initial }: { initial: InitialDesign }) {
  const isView = initial.mode === 'view';
  // Lazy initializers: the FIRST render already has the saved design. Loading
  // in an effect instead would render defaults, then swap — Scene reads that
  // as a shape change and flies the camera, and history records a fake step.
  const [shape, setShape] = useState<Shape>(() => initial.design?.shape ?? defaultShape());
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => initial.design?.colorScheme ?? defaultColorScheme());
  const [profileScheme, setProfileScheme] = useState<ProfileScheme>(
    () => initial.design?.profileScheme ?? defaultProfileScheme(),
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [timeOfDayHours, setTimeOfDayHours] = useState(12); // noon by default
  const [sheetHeight, setSheetHeight] = useState(260);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const { expandedLegIndices, setExpandedLegIndices, legRefs, legCameraFocus, toggleLeg } = usePanelState(selection);
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

  const {
    undo,
    redo,
    canUndo,
    canRedo,
    beginHistoryTransaction,
    commitHistoryTransaction,
  } = useHistory(shape,
    colorScheme,
    profileScheme,
    setShape,
    setColorScheme,
    setProfileScheme,
  );

  // Autosave — edit mode ONLY. View mode never writes: opening your own view
  // link in the same browser would otherwise overwrite your local work.
  const latestSnapshotRef = useRef<DesignSnapshot | null>(null);
  useEffect(() => {
    if (isView) return;
    const snapshot = makeSnapshot(shape, colorScheme, profileScheme);
    latestSnapshotRef.current = snapshot;
    const id = window.setTimeout(() => saveLocalDesign(snapshot), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [isView, shape, colorScheme, profileScheme]);

  // Flush on leave, so a refresh inside the debounce window loses nothing.
  useEffect(() => {
    if (isView) return;
    const flush = () => {
      if (latestSnapshotRef.current) saveLocalDesign(latestSnapshotRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [isView]);

  // Mode is read once at startup. A view link pasted into an open tab only
  // changes the hash (no reload) — reload so the mode is re-read.
  useEffect(() => {
    const onHashChange = () => {
      if (isView || isViewHash(window.location.hash)) window.location.reload();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [isView]);

  // Back to the default design. One handler, so React batches all setters
  // into one render — one history entry, undoable with a single Ctrl+Z.
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  // Bug report: description → one text blob on the clipboard.
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugText, setBugText] = useState('');
  /** Set when the clipboard is blocked — the report is shown for manual copy. */
  const [bugFallbackText, setBugFallbackText] = useState<string | null>(null);
  const [bugCopiedToast, setBugCopiedToast] = useState(false);
  const bugToastTimeoutRef = useRef<number | null>(null);

  function openBugReport() {
    setBugText('');
    setBugFallbackText(null);
    setBugReportOpen(true);
  }

  async function copyBugReport() {
    const report = buildBugReport({
      description: bugText.trim(),
      snapshot: makeSnapshot(shape, colorScheme, profileScheme),
      selection,
      stats,
    });
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      setBugFallbackText(report);
      return;
    }
    setBugReportOpen(false);
    setBugCopiedToast(true);
    if (bugToastTimeoutRef.current) window.clearTimeout(bugToastTimeoutRef.current);
    bugToastTimeoutRef.current = window.setTimeout(() => setBugCopiedToast(false), BUG_TOAST_MS);
  }

  // Esc closes whichever dialog is open — listener lives only while one is.
  useEffect(() => {
    if (!confirmResetOpen && !bugReportOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setConfirmResetOpen(false);
      setBugReportOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmResetOpen, bugReportOpen]);

  function resetDesign() {
    setConfirmResetOpen(false);
    setSelection(null);
    setShape(defaultShape());
    setColorScheme(defaultColorScheme());
    setProfileScheme(defaultProfileScheme());
    setLengthPrecision({});
    setBaseHeightPrecision({});
  }

  function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault(); // stops the browser starting a text-selection drag
    dragStartRef.current = { startY: e.clientY, startHeight: sheetHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  } function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
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
    boardCountByLeg: {} as Record<number, number>,
    boardCountByField: {} as Record<string, number>,
  });

  const {
    updateLeg,
    updateLegLength,
    setJunction,
    addLeg,
    addLegAtStart,
    removeLastLeg,
    setPostColor,
    addColorRule,
    pickBoardColor,
    addProfileRule,
    addSpacerRule,
    pickSpacer,
    pickBoardProfile,
    clearFieldProfile,
    applyFieldToSegment,
    undoApplyFenceToast,
    pendingBoardColor,
    pendingModelId,
    pendingSizeId,
    pendingSpacer,
    applyToAllFields,
    setApplyToAllFields,
    applyFenceToast,
    undoPulse,
  } = useFenceEditor(
    shape,
    setShape,
    colorScheme,
    setColorScheme,
    profileScheme,
    setProfileScheme,
    selection,
    setExpandedLegIndices,
    undo,
  );

  // "יש לשדה הזה משהו לשחזר" — profile, spacer, או צבע. במקור זה בדק רק
  // profile/spacer, ולכן שדה עם צבע מותאם בלבד השאיר את הכפתור מושבת.
  const selectedFieldHasCustomizations = (() => {
    if (selection?.kind !== 'board') return false;
    const { legIndex, fieldIndex } = selection;
    return (
      profileScheme.rules.some((r) => r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex) ||
      profileScheme.spacerRules.some(
        (r) => r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex,
      ) ||
      colorScheme.boardRules.some((r) => r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex)
    );
  })();

  // Total step count for the SELECTED field specifically — not summed
  // across the leg (see boardCountByField's doc comment in Scene.tsx):
  // sibling fields in the same leg can have different counts once
  // field-scoped rules are in play.
  const selectedFieldTotalSteps = (() => {
    if (selection?.kind !== 'board') return 0;
    return stats.boardCountByField[`${selection.legIndex}:${selection.fieldIndex}`] ?? 0;
  })();

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
            timeOfDayHours={timeOfDayHours}
          />

          <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 5 }}>
            <CircularTimeSlider hours={timeOfDayHours} onChange={setTimeOfDayHours} />
          </div>
          {isView && <ViewDisclaimer />}

          {isView && selection && (
            <button type="button" className="view-exit-focus" onClick={() => setSelection(null)}>
              יציאה מפוקוס ✕
            </button>
          )}

          {!isView && (
            <ShareLinkButton getSnapshot={() => makeSnapshot(shape, colorScheme, profileScheme)} />
          )}

          {!isView && (
            <div className="debug-corner">
              <div className="stats-badge">
                <div>{stats.fps} FPS</div>
                <div>{stats.drawCalls} draw calls</div>
                <div>{stats.triangles.toLocaleString()} triangles</div>
              </div>
              <button className="history-btn" onClick={openBugReport} title="דיווח על באג" aria-label="דיווח על באג">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ display: 'block', margin: 'auto' }}
                  aria-hidden="true"
                >
                  <path d="m8 2 1.88 1.88" />
                  <path d="M14.12 3.88 16 2" />
                  <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
                  <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
                  <path d="M12 20v-9" />
                  <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
                  <path d="M6 13H2" />
                  <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
                  <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
                  <path d="M22 13h-4" />
                  <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
                </svg>
              </button>
            </div>
          )}

          {bugReportOpen && (
            <>
              <div className="value-popover-backdrop" onClick={() => setBugReportOpen(false)} />
              <div className="value-popover value-popover-wide" role="dialog" aria-modal="true" dir="rtl">
                <div className="value-popover-title">דיווח על באג</div>
                {bugFallbackText === null ? (
                  <>
                    <p className="value-popover-hint">
                      מה עשית, ומה ציפית שיקרה? מצב הגדר, הגרסה והמסך מצורפים אוטומטית.
                    </p>
                    <textarea
                      className="bug-report-input"
                      rows={4}
                      value={bugText}
                      onChange={(e) => setBugText(e.target.value)}
                      // Keep Ctrl+Z inside the textarea — never undo the fence while typing.
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') setBugReportOpen(false);
                      }}
                      placeholder="לדוגמה: שיניתי גובה במקטע 2 והשלב העליון נעלם"
                      autoFocus
                    />
                  </>
                ) : (
                  <>
                    <p className="value-popover-hint">ההעתקה האוטומטית נחסמה — סמנו את הטקסט והעתיקו ידנית.</p>
                    <textarea
                      className="bug-report-input"
                      rows={8}
                      readOnly
                      value={bugFallbackText}
                      onFocus={(e) => e.currentTarget.select()}
                      autoFocus
                    />
                  </>
                )}
                <div className="value-popover-actions">
                  {bugFallbackText === null && (
                    <button type="button" className="value-popover-apply" onClick={copyBugReport}>
                      העתק דיווח
                    </button>
                  )}
                  <button type="button" className="value-popover-cancel" onClick={() => setBugReportOpen(false)}>
                    {bugFallbackText === null ? 'ביטול' : 'סגור'}
                  </button>
                </div>
              </div>
            </>
          )}

          {!isView && bugCopiedToast && (
            <div className="toast">
              <span className="toast-message">הדיווח הועתק — הדביקו ושלחו</span>
            </div>
          )}

          {!isView && (
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
              <button
                className="history-btn"
                onClick={() => setConfirmResetOpen(true)}
                title="עיצוב חדש"
                aria-label="עיצוב חדש"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ display: 'block', margin: 'auto' }}
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            </div>
          )}

          {confirmResetOpen && (
            // Same popover as the manual value entry (App.css .value-popover-*).
            <>
              <div className="value-popover-backdrop" onClick={() => setConfirmResetOpen(false)} />
              <div className="value-popover" role="dialog" aria-modal="true" dir="rtl">
                <div className="value-popover-title">להתחיל עיצוב חדש?</div>
                <p className="value-popover-hint">הגדר תחזור לברירת המחדל. אפשר לבטל בכל רגע עם כפתור החזור או Ctrl+Z.</p>
                <div className="value-popover-actions">
                  <button type="button" className="value-popover-apply" onClick={resetDesign}>
                    עיצוב חדש
                  </button>
                  {/* Focus starts on cancel — a stray Enter must not wipe the design. */}
                  <button
                    type="button"
                    className="value-popover-cancel"
                    onClick={() => setConfirmResetOpen(false)}
                    autoFocus
                  >
                    ביטול
                  </button>
                </div>
              </div>
            </>
          )}

          {!isView && applyFenceToast && (
            <div className="toast">
              <span className="toast-message">העיצוב של השדה הוחל על כל הגדר</span>
              <button className="toast-undo" onClick={undoApplyFenceToast}>
                בטל ↺
              </button>
              {applyFenceToast.showHint && <div className="toast-hint">תמיד אפשר לבטל שינויים גדולים</div>}
            </div>
          )}
        </div>

        {!isView && selection?.kind === 'post' && (
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

        {!isView && selection?.kind === 'board' && (
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
                  ? `עריכת שלבים — ${selection.stepIndices.length} שלבים נבחרו מתוך ${selectedFieldTotalSteps}`
                  : `שלב ${selection.stepIndex + 1} מתוך ${selectedFieldTotalSteps} — בגובה ${Math.round(selection.heightCm)} ס״מ`}{' '}
                (מקטע {selection.legIndex + 1}, שדה{' '}
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
                    {SPACER_OPTIONS.map((opt) => (
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
                      onClick={() => addColorRule('below', Math.min(...selection.stepIndices), pendingBoardColor)}
                    >
                      מהשלב הזה ומטה ↓
                    </button>
                    <button
                      className="text-btn"
                      onClick={() => addColorRule('above', Math.max(...selection.stepIndices), pendingBoardColor)}
                    >
                      מהשלב הזה ומעלה ↑
                    </button>
                  </div>
                </div>

                <div className="field-actions">
                  {/* The three scopes, smallest to largest: this field, this
                      segment, the whole fence. The toggle lives here rather
                      than beside each carousel because it is the only one of
                      the three that is global — duplicating it per attribute
                      made it look local, which it never was. */}
                  <label className="group-toggle">
                    <input
                      type="checkbox"
                      checked={applyToAllFields}
                      onChange={(e) => setApplyToAllFields(e.target.checked)}
                    />
                    החל על כל הגדר
                  </label>

                  <button type="button" className="apply-fence-btn" onClick={applyFieldToSegment}>
                    החל שדה זה על כל המקטע
                  </button>

                  <button
                    type="button"
                    className="text-btn"
                    disabled={!selectedFieldHasCustomizations}
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

      {!isView && (
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
            <h1>הגדרות צורה - גדר פרוצדורלית</h1>
            <p className="hint">
              מקטע הוא היחידה הבסיסית.
              לכל מקטע אפשר להגדיר גובה חומה, אורך, וגובה סגירה משלו.
              אפשר להגדיר את הכיוון של הצומת בין כל 2 מקטעים.
              לחיצה על עמוד נותנת אפשרות לקבוע צבע לכל העמודים.
              לחיצה על שלב תתמקד בשלב ספציפי ותאפשר לשנות את העיצוב ידנית.
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
                          onInteractionStart={beginHistoryTransaction}
                          onInteractionEnd={commitHistoryTransaction}
                        />

                        <HeightSnapSlider
                          label="גובה גדר"
                          leg={leg}
                          boardCount={stats.boardCountByLeg[legIndex] ?? 0}
                          onChangeHeight={(v) => updateLeg(legIndex, (l) => ({ ...l, heightCm: v }))}
                          onInteractionStart={beginHistoryTransaction}
                          onInteractionEnd={commitHistoryTransaction}
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
                          onInteractionStart={beginHistoryTransaction}
                          onInteractionEnd={commitHistoryTransaction}
                        />

                        {getPrecision(baseHeightPrecision, legIndex).on && leg.baseHeightCm > 0 && (
                          <div className="leg-row">
                            <span className="value-trigger">רוחב חומה: {formatTrimmed(leg.wallWidthCm, 1)} ס״מ</span>
                            <input
                              type="range"
                              min={Math.max(20, POST_THICKNESS_CM * POST_ACCESSORY_WIDTH_MULTIPLIER)} // 20cm product default floor, but never narrower than the rosette sitting on top of it
                              max={Math.max(40, POST_THICKNESS_CM * POST_ACCESSORY_WIDTH_MULTIPLIER * 2)} // placeholder ceiling — ask the client for a real range
                              step={0.5}
                              value={leg.wallWidthCm}
                              onChange={(e) => updateLeg(legIndex, (l) => ({ ...l, wallWidthCm: Number(e.target.value) }))}
                            />
                          </div>
                        )}
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
              <button
                type="button"
                className="pill segment-action-btn"
                onClick={addLegAtStart}
              >
                הוסף מקטע בהתחלה +
              </button>

              <button
                type="button"
                className="pill segment-action-btn"
                onClick={addLeg}
              >
                הוסף מקטע בסוף +
              </button>

              {shape.legs.length > 1 && (
                <button
                  type="button"
                  className="pill segment-action-btn"
                  onClick={removeLastLeg}
                >
                  הסר מקטע -
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
      )}
    </div>
  );
}

/**
 * Entry: reads mode + saved/linked design once, then renders. A broken view
 * link never falls through to the editor — a customer must never land in it.
 */
export default function App() {
  const [initial] = useState(readInitialDesign);
  const brokenViewLink = initial.mode === 'view' && !initial.design;

  return (
    <DesignErrorBoundary mode={initial.mode}>
      {brokenViewLink ? (
        <CenteredNotice
          title="הקישור לא תקין"
          body="לא הצלחנו לפתוח את ההדמיה מהקישור הזה. ייתכן שהוא נקטע בהעתקה — אפשר לבקש קישור חדש."
        />
      ) : (
        <FenceApp initial={initial} />
      )}
    </DesignErrorBoundary>
  );
}