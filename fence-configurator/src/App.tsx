import { useEffect, useRef, useState } from 'react';
import Scene, { type ColorScheme, type Selection, resolveBoardColorHex } from './scene/Scene';
import type { Shape, Leg, Junction } from './geometry/shape';
import { DEFAULT_MODEL_ID, DEFAULT_SIZE_ID, FENCE_CATALOG } from './geometry/catalog';
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

function defaultShape(): Shape {
  return {
    legs: [{ lengthM: 6, baseHeightCm: 0, heightCm: 120, modelId: DEFAULT_MODEL_ID, sizeId: DEFAULT_SIZE_ID }],
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

export default function App() {
  const [shape, setShape] = useState<Shape>(defaultShape());
  const [colorScheme, setColorScheme] = useState<ColorScheme>(defaultColorScheme());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pendingBoardColor, setPendingBoardColor] = useState(FENCE_COLORS[0].hex);
  const [applyToAllFields, setApplyToAllFields] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(260);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Undo/redo — covers everything in shape + colorScheme (lengths, heights,
  // legs, junctions, post/board colors). Every change to either pushes a
  // new snapshot, except when the change came FROM undo/redo itself
  // (isUndoRedoRef guards against re-recording that as a new step).
  const [history, setHistory] = useState<{ entries: { shape: Shape; colorScheme: ColorScheme }[]; index: number }>(
    () => ({ entries: [{ shape, colorScheme }], index: 0 }),
  );
  const isUndoRedoRef = useRef(false);

  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    setHistory((h) => {
      const truncated = h.entries.slice(0, h.index + 1);
      return { entries: [...truncated, { shape, colorScheme }], index: truncated.length };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, colorScheme]);

  function undo() {
    if (history.index <= 0) return;
    const newIndex = history.index - 1;
    isUndoRedoRef.current = true;
    setShape(history.entries[newIndex].shape);
    setColorScheme(history.entries[newIndex].colorScheme);
    setHistory((h) => ({ ...h, index: newIndex }));
  }
  function redo() {
    if (history.index >= history.entries.length - 1) return;
    const newIndex = history.index + 1;
    isUndoRedoRef.current = true;
    setShape(history.entries[newIndex].shape);
    setColorScheme(history.entries[newIndex].colorScheme);
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
  });

  function updateLeg(legIndex: number, updater: (leg: Leg) => Leg) {
    setShape((prev) => ({
      ...prev,
      legs: prev.legs.map((leg, i) => (i === legIndex ? updater(leg) : leg)),
    }));
  }

  function setJunction(junctionIndex: number, type: Junction['type']) {
    setShape((prev) => ({
      ...prev,
      junctions: prev.junctions.map((j, i) => (i === junctionIndex ? { type } : j)),
    }));
  }

  function addLeg() {
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
          },
        ],
        junctions: [...prev.junctions, { type: 'straight' }],
      };
    });
  }

  function removeLastLeg() {
    setShape((prev) => {
      if (prev.legs.length <= 1) return prev;
      return { legs: prev.legs.slice(0, -1), junctions: prev.junctions.slice(0, -1) };
    });
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

  // Clicking a swatch paints just the clicked board immediately — below/above
  // are follow-up actions to extend from there, not required first steps.
  function pickBoardColor(hex: string) {
    setPendingBoardColor(hex);
    if (selection?.kind === 'board') {
      addColorRule('exact', selection.heightCm, hex);
    }
  }

  // Seed the picker with the CLICKED board's actual current color, instead
  // of leaving whatever color was last picked for a different board — that
  // staleness was its own source of "why did it apply the wrong color".
  useEffect(() => {
    if (selection?.kind === 'board') {
      setPendingBoardColor(resolveBoardColorHex(colorScheme, selection.legIndex, selection.fieldIndex, selection.heightCm));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  return (
    <div className="app">
      <div className="scene-area">
        <Scene shape={shape} colorScheme={colorScheme} selection={selection} onSelect={setSelection} onStats={setStats} />
        <div className="stats-badge">
          <div>{stats.fps} FPS</div>
          <div>{stats.drawCalls} draw calls</div>
          <div>{stats.triangles.toLocaleString()} triangles</div>
        </div>

        <div className="history-controls">
          <button className="history-btn" onClick={undo} disabled={!canUndo} title="בטל (Ctrl+Z)">
            ↶
          </button>
          <button className="history-btn" onClick={redo} disabled={!canRedo} title="בצע שוב (Ctrl+Y)">
            ↷
          </button>
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
                שלב נבחר — בגובה {Math.round(selection.heightCm)} ס״מ (רגל {selection.legIndex + 1}, שדה{' '}
                {selection.fieldIndex + 1})
              </span>
              <button className="text-btn" onClick={() => setSelection(null)}>
                סגור ✕
              </button>
            </div>
            <div className="bottom-sheet-content">

            <div className="carousel-row">
              <span className="carousel-label">סוג (לרגל זו בלבד)</span>
              <div className="carousel">
                {FENCE_CATALOG.map((model, i) => (
                  <button
                    key={model.id}
                    className={
                      shape.legs[selection.legIndex].modelId === model.id ? 'carousel-item active' : 'carousel-item'
                    }
                    onClick={() =>
                      updateLeg(selection.legIndex, (l) => ({ ...l, modelId: model.id, sizeId: model.sizes[0].id }))
                    }
                  >
                    {model.name ?? `סוג ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="carousel-row">
              <span className="carousel-label">גודל</span>
              <div className="carousel">
                {(FENCE_CATALOG.find((m) => m.id === shape.legs[selection.legIndex].modelId) ?? FENCE_CATALOG[0]).sizes.map(
                  (size) => (
                    <button
                      key={size.id}
                      className={
                        shape.legs[selection.legIndex].sizeId === size.id ? 'carousel-item active' : 'carousel-item'
                      }
                      onClick={() => updateLeg(selection.legIndex, (l) => ({ ...l, sizeId: size.id }))}
                    >
                      {size.name ?? `${size.boardHeightCm}/${size.spacerHeightCm} ס״מ`}
                    </button>
                  ),
                )}
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
            </div>
            <div className="split-actions">
              <button className="text-btn" onClick={() => addColorRule('below', selection.heightCm, pendingBoardColor)}>
                מהשלב הזה ומטה ↓
              </button>
              <button className="text-btn" onClick={() => addColorRule('above', selection.heightCm, pendingBoardColor)}>
                מהשלב הזה ומעלה ↑
              </button>
            </div>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h1>בילדר צורה — גדר פרוצדורלית</h1>
        <p className="hint">
          רגל היא היחידה הבסיסית — לכל רגל גובה חומה קיים וגובה סגירה משלה. הצומת בין כל שתי
          רגליים קובע הכל: 90° (ימינה/שמאלה), ישר (רק שינוי גובה), או נתק (שתי גדרות נפרדות
          לגמרי, בלי עמוד משותף). לחיצה על עמוד בסצנה קובעת צבע לכל העמודים; לחיצה על שלב
          פותחת בחירת צבע מפוצלת לפי גובה.
        </p>

        {shape.legs.map((leg, legIndex) => (
          <div key={legIndex}>
            <div className="segment-block">
              <div className="segment-header">
                <span>רגל {legIndex + 1}</span>
              </div>

              <label className="leg-row">
                אורך: {leg.lengthM.toFixed(1)} מ׳
                <input
                  type="range"
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={leg.lengthM}
                  onChange={(e) => updateLeg(legIndex, (l) => ({ ...l, lengthM: Number(e.target.value) }))}
                />
              </label>

              <label className="leg-row base-height-row">
                גובה חומה קיים: {leg.baseHeightCm} ס״מ
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, leg.heightCm - 20)}
                  step={5}
                  value={leg.baseHeightCm}
                  onChange={(e) => updateLeg(legIndex, (l) => ({ ...l, baseHeightCm: Number(e.target.value) }))}
                />
              </label>

              <label className="leg-row">
                גובה סגירה: {leg.heightCm} ס״מ
                <input
                  type="range"
                  min={60}
                  max={200}
                  step={5}
                  value={leg.heightCm}
                  onChange={(e) => updateLeg(legIndex, (l) => ({ ...l, heightCm: Number(e.target.value) }))}
                />
              </label>
            </div>

            {shape.junctions[legIndex] && (
              <div className="corner-row junction-row">
                <span>צומת:</span>
                {(['right', 'left', 'straight', 'disconnect'] as const).map((t) => (
                  <button
                    key={t}
                    className={shape.junctions[legIndex].type === t ? 'pill active' : 'pill'}
                    onClick={() => setJunction(legIndex, t)}
                  >
                    {JUNCTION_LABELS[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

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
            <span>עמודים</span>
            <strong>{stats.postCount}</strong>
          </div>
          <div>
            <span>עמודים כפולים</span>
            <strong>{stats.doublePostCount}</strong>
          </div>
          <div>
            <span>לוחות</span>
            <strong>{stats.boardCount}</strong>
          </div>
        </div>

        <p className="footnote">מידות עמוד, עובי לוח ועומק חריץ עדיין PLACEHOLDER — ראה constants.ts.</p>
      </div>
    </div>
  );
}