import { useState } from 'react';
import Scene from './scene/Scene';
import { MAX_CHAIN_ANGLE_DEG } from './geometry/constants';
import './App.css';

const FENCE_COLORS = [
  { name: 'אנתרסיט', hex: '#3a3f44' },
  { name: 'חום אגוז', hex: '#6b4a34' },
  { name: 'לבן', hex: '#e8e6e1' },
  { name: 'ירוק בקבוק', hex: '#3f5a45' },
];

export default function App() {
  const [totalLengthM, setTotalLengthM] = useState(6);
  const [heightCm, setHeightCm] = useState(120);
  const [bendAngleDeg, setBendAngleDeg] = useState(0);
  const [fenceColor, setFenceColor] = useState(FENCE_COLORS[0].hex);
  const [stats, setStats] = useState({ fps: 0, drawCalls: 0, triangles: 0, boardCount: 0, postCount: 0 });

  return (
    <div className="app">
      <div className="scene-area">
        <Scene
          totalLengthM={totalLengthM}
          heightCm={heightCm}
          bendAngleDeg={bendAngleDeg}
          fenceColor={fenceColor}
          onStats={setStats}
        />
        <div className="stats-badge">
          <div>{stats.fps} FPS</div>
          <div>{stats.drawCalls} draw calls</div>
          <div>{stats.triangles.toLocaleString()} triangles</div>
        </div>
      </div>

      <div className="panel">
        <h1>ספייק בדיקת ביצועים — גדר פרוצדורלית</h1>
        <p className="hint">
          כל הגיאומטריה כאן נוצרת בזמן אמת ממתמטיקה (לא מודלים שמורים מראש) — זו בדיוק
          ההנחה שרצינו לבדוק לפני שסוגרים בין Unity לבין web.
        </p>

        <label>
          אורך ריצה כולל: {totalLengthM.toFixed(1)} מ׳
          <input type="range" min={1} max={30} step={0.5} value={totalLengthM}
            onChange={(e) => setTotalLengthM(Number(e.target.value))} />
        </label>

        <label>
          גובה גדר: {heightCm} ס״מ
          <input type="range" min={60} max={200} step={5} value={heightCm}
            onChange={(e) => setHeightCm(Number(e.target.value))} />
        </label>

        <label>
          זווית עקומה למפרק: {bendAngleDeg}°
          <input type="range" min={0} max={MAX_CHAIN_ANGLE_DEG} step={1} value={bendAngleDeg}
            onChange={(e) => setBendAngleDeg(Number(e.target.value))} />
        </label>

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
          <div><span>עמודים</span><strong>{stats.postCount}</strong></div>
          <div><span>לוחות (סה״כ)</span><strong>{stats.boardCount}</strong></div>
        </div>

        <p className="footnote">
          מידות עמוד, עובי לוח ועומק חריץ עדיין PLACEHOLDER — ראה constants.ts.
        </p>
      </div>
    </div>
  );
}
