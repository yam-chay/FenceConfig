import { useRef } from 'react';
import { drawingBackdropCss } from '../../scene/environment/drawingGrid';

/**
 * Drawing mode's backdrop slider — takes the time dial's place only while
 * drawing mode is on. A flat track from the light paper (left) to the dark
 * grey (right), dragged like the dial's handle. Ends are read from
 * drawingGrid's own palettes, so the track always shows the real colors.
 */
export function BackdropSlider({ level, onChange }: { level: number; onChange: (level: number) => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  function levelAt(clientX: number): number {
    const el = trackRef.current;
    if (!el) return level;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    onChange(levelAt(e.clientX));
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    onChange(levelAt(e.clientX));
  }
  function handlePointerUp() {
    draggingRef.current = false;
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.1 : 0;
    if (step === 0) return;
    e.preventDefault();
    onChange(Math.min(1, Math.max(0, level + step)));
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="צבע רקע"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      title="צבע רקע"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        direction: 'ltr',
        width: 150,
        height: 26,
        borderRadius: 13,
        background: `linear-gradient(to right, ${drawingBackdropCss(0)}, ${drawingBackdropCss(1)})`,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3) inset',
      }}
    >
      <div
        style={{
          position: 'absolute',
          // Inset by the handle's radius so it never hangs past the track's rounded ends.
          left: `calc(11px + ${level} * (100% - 22px))`,
          top: '50%',
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: drawingBackdropCss(level),
          border: '2px solid #fff',
          boxSizing: 'border-box',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }}
      />
    </div>
  );
}
