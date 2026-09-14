import { useState } from 'react';
import Scene from './scene/Scene';
import type { Shape, Leg, Junction } from './geometry/shape';
import { DEFAULT_MODEL_ID, DEFAULT_SIZE_ID } from './geometry/catalog';
import './App.css';

const FENCE_COLORS = [
  { name: 'אנתרסיט', hex: '#3a3f44' },
  { name: 'חום אגוז', hex: '#6b4a34' },
  { name: 'לבן', hex: '#e8e6e1' },
  { name: 'ירוק בקבוק', hex: '#3f5a45' },
];

const JUNCTION_LABELS: Record<Junction['type'], string> = {
  right: 'ימינה',
  left: 'שמאלה',
  straight: 'ישר',
  disconnect: 'נתק',
};

function defaultShape(): Shape {
  return {
    legs: [{ lengthM: 6, baseHeightCm: 0, heightCm: 120, modelId: DEFAULT_MODEL_ID, sizeId: DEFAULT_SIZE_ID }],
    junctions: [],
  };
}

export default function App() {
  const [shape, setShape] = useState<Shape>(defaultShape());
  const [fenceColor, setFenceColor] = useState(FENCE_COLORS[0].hex);
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

  return (
    <div className="app">
      <div className="scene-area">
        <Scene shape={shape} fenceColor={fenceColor} onStats={setStats} />
        <div className="stats-badge">
          <div>{stats.fps} FPS</div>
          <div>{stats.drawCalls} draw calls</div>
          <div>{stats.triangles.toLocaleString()} triangles</div>
        </div>
      </div>

      <div className="panel">
        <h1>בילדר צורה — גדר פרוצדורלית</h1>
        <p className="hint">
          רגל היא היחידה הבסיסית — לכל רגל גובה חומה קיים וגובה סגירה משלה. הצומת בין כל שתי
          רגליים קובע הכל: 90° (ימינה/שמאלה), ישר (רק שינוי גובה), או נתק (שתי גדרות נפרדות
          לגמרי, בלי עמוד משותף).
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

        <div className="colors">
          {FENCE_COLORS.map((c) => (
            <button
              key={c.hex}
              className={c.hex === fenceColor ? 'swatch active' : 'swatch'}
              style={{ background: c.hex }}
              onClick={() => setFenceColor(c.hex)}
              title={c.name}
            />
          ))}
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
