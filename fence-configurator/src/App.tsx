import { useRef, useState } from 'react';
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
import './App.css';

const JUNCTION_LABELS: Record<Junction['type'], string> = {
  right: 'שמאלה',
  left: 'ימינה',
  straight: 'ישר',
  disconnect: 'נתק',
};

export default function App() {
  const [shape, setShape] = useState<Shape>(defaultShape());
  const [colorScheme, setColorScheme] = useState<ColorScheme>(defaultColorScheme());
  const [profileScheme, setProfileScheme] = useState<ProfileScheme>(defaultProfileScheme());
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
    cancelHistoryTransaction,
  } = useHistory(shape,
    colorScheme,
    profileScheme,
    setShape,
    setColorScheme,
    setProfileScheme,
  );

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
    applyFieldToEntireFence,
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
                  ? `עריכת שלבים — ${selection.stepIndices.length} שלבים נבחרו מתוך ${selectedFieldTotalSteps}`
                  : `שלב ${selection.stepIndex + 1} מתוך ${selectedFieldTotalSteps} — בגובה ${Math.round(selection.heightCm)} ס״מ`}{' '}
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
                  <button type="button" className="apply-fence-btn" onClick={applyFieldToEntireFence}>
                    החל שדה זה על כל הגדר
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

                      <HeightSnapSlider
                        label="גובה גדר"
                        leg={leg}
                        boardCount={stats.boardCountByLeg[legIndex] ?? 0}
                        onChangeHeight={(v) => updateLeg(legIndex, (l) => ({ ...l, heightCm: v }))}
                        onInteractionStart={beginHistoryTransaction}
                        onInteractionEnd={commitHistoryTransaction}
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
    </div>
  );
}