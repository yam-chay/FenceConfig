import { useEffect, useRef, useState } from 'react';
import Scene, {
  type ColorScheme,
  type ProfileScheme,
  type Selection,
  resolveBoardColorHex,
  resolveBoardProfile,
  resolveSpacerMultiplier,
} from './scene/Scene';
import type { Shape, Leg, Junction } from './geometry/shape';
import { DEFAULT_MODEL_ID, DEFAULT_SIZE_ID, FENCE_CATALOG } from './geometry/catalog';
import { MAX_FIELD_LENGTH_M } from './geometry/constants';
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

function defaultProfileScheme(): ProfileScheme {
  return { rules: [], spacerRules: [] };
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [applyToAllFields, setApplyToAllFields] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(260);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

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
  });

  function updateLeg(legIndex: number, updater: (leg: Leg) => Leg) {
    setShape((prev) => ({
      ...prev,
      legs: prev.legs.map((leg, i) => (i === legIndex ? updater(leg) : leg)),
    }));
  }

  function fieldCountFor(lengthM: number) {
    return Math.max(1, Math.ceil(lengthM / MAX_FIELD_LENGTH_M));
  }

  // Length is the only leg input that changes how many fields the leg
  // splits into — when it grows past a split point, every NEW field starts
  // as a copy of the previous last field's pattern (confirmed behavior).
  function updateLegLength(legIndex: number, newLengthM: number) {
    const oldCount = fieldCountFor(shape.legs[legIndex].lengthM);
    const newCount = fieldCountFor(newLengthM);
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
    const lastFieldIndex = fieldCountFor(lastLeg.lengthM) - 1;
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
    // New leg = continuation of the shape: its fields inherit the pattern
    // of the field they extend from (the previous leg's last field).
    const newLegFieldCount = fieldCountFor(3);
    const newIndexes: number[] = [];
    for (let f = 0; f < newLegFieldCount; f++) newIndexes.push(f);
    cloneFieldProfileRules(lastLegIndex, lastFieldIndex, lastLegIndex + 1, newIndexes);
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
  // deaf to the leg-level "סוג פרופיל (לכל המקטע)" control for whatever
  // height range that rule covers — even if you've since repainted every
  // step back to the same type, since that's still explicit rules, not "no
  // rules". Repainting to look uniform again doesn't undo that; this does,
  // on purpose, rather than guessing from the resolved colors/types whether
  // a field "counts" as still customized.
  function clearFieldProfile(legIndex: number, fieldIndex: number) {
    setProfileScheme((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => !(r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex)),
      spacerRules: prev.spacerRules.filter(
        (r) => !(r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex),
      ),
    }));
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

  return (
    <div className="app">
      <div className="scene-area">
        <Scene
          shape={shape}
          colorScheme={colorScheme}
          profileScheme={profileScheme}
          selection={selection}
          onSelect={setSelection}
          onStats={setStats}
        />
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

            <div className="carousel-row">
              <span className="carousel-label">סוג פרופיל (לכל המקטע)</span>
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
                <span className="carousel-label">פרופיל השלב הזה — לחיצה קובעת מיד רק אותו</span>
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
            </div>
            <div className="split-actions">
              <button
                className="text-btn"
                onClick={() => addProfileRule('below', Math.min(...selection.stepIndices), pendingModelId, pendingSizeId)}
              >
                מהשלב הזה ומטה ↓
              </button>
              <button
                className="text-btn"
                onClick={() => addProfileRule('above', Math.max(...selection.stepIndices), pendingModelId, pendingSizeId)}
              >
                מהשלב הזה ומעלה ↑
              </button>
              {(profileScheme.rules.some(
                (r) => r.scope === 'field' && r.legIndex === selection.legIndex && r.fieldIndex === selection.fieldIndex,
              ) ||
                profileScheme.spacerRules.some(
                  (r) =>
                    r.scope === 'field' && r.legIndex === selection.legIndex && r.fieldIndex === selection.fieldIndex,
                )) && (
                <button
                  className="text-btn"
                  onClick={() => clearFieldProfile(selection.legIndex, selection.fieldIndex)}
                >
                  אפס שדה לברירת המחדל של המקטע ↺
                </button>
              )}
            </div>

            <div className="carousel-row">
              <button className="text-btn" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'אפשרויות מתקדמות ▴' : 'אפשרויות מתקדמות ▾'}
              </button>
              {showAdvanced && (
                <>
                  <span className="carousel-label" style={{ marginTop: 8 }}>
                    רווח מתחת לשלב הזה — לחיצה קובעת מיד רק אותו
                  </span>
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
                </>
              )}
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
          </div>
        )}
      </div>

      <div className={selection ? 'panel panel-yield-mobile' : 'panel'}>
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
                  onChange={(e) => updateLegLength(legIndex, Number(e.target.value))}
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