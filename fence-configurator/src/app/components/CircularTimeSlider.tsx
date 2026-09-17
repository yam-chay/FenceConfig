import { useRef } from 'react';
import { DAY_NIGHT_KEYFRAMES } from '../../scene/Scene';

/**
 * Circular time-of-day dial — a draggable handle around a full ring,
 * instead of a linear <input type="range">. Ring colors are pulled
 * directly from DAY_NIGHT_KEYFRAMES's own sky colors (single source of
 * truth with Scene.tsx — no duplicated color list to drift out of sync).
 *
 * Angle convention: 0° = TOP (12 o'clock) = hour 0, increasing CLOCKWISE
 * as hour increases — matches CSS conic-gradient's own default direction
 * (from 0deg, clockwise), so the gradient and the handle math agree
 * without any extra offset juggling.
 */
export function CircularTimeSlider({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Single rotation constant — shifts the WHOLE dial (gradient colors +
  // handle placement + drag math) together so they stay in sync. 180°
  // puts the brightest keyframe (noon, index 4) at the top and the
  // darkest (midnight, index 0) at the bottom, instead of the
  // "unrotated" default where midnight sits at top. Change this ONE
  // number to re-tune the orientation — never hand-swap which keyframe
  // index feeds which variable below, that was the earlier hack and it
  // desyncs the handle from the visual gradient.
  const DIAL_ROTATION_DEG = 180;
  const DIAL_ROTATION_RAD = (DIAL_ROTATION_DEG * Math.PI) / 180;

  // Honest labels again — night truly IS the night color, etc. Indices:
  // 0=hour0(night), 2=hour6.5(sunrise), 4=hour12(day), 6=hour17.5(sunset).
  const night = `#${DAY_NIGHT_KEYFRAMES[0].skyMid.getHexString()}`;
  const sunrise = `#${DAY_NIGHT_KEYFRAMES[2].skyMid.getHexString()}`;
  const day = `#${DAY_NIGHT_KEYFRAMES[4].skyMid.getHexString()}`;
  const sunset = `#${DAY_NIGHT_KEYFRAMES[6].skyMid.getHexString()}`;
  // `from ${DIAL_ROTATION_DEG}deg` rotates the WHOLE authored pattern
  // (whose stops below still assume 0deg=night/top, unrotated) to the
  // actual visual angle — same rotation angleToHours/handleAngle apply
  // below, so all three agree on where "hour 0" visually sits.
  const gradient = `conic-gradient(from ${DIAL_ROTATION_DEG}deg,
    ${night} 0deg, ${night} 82deg,
    ${sunrise} 96deg,
    ${day} 112deg, ${day} 248deg,
    ${sunset} 264deg,
    ${night} 278deg, ${night} 360deg
  )`;

  function angleToHours(clientX: number, clientY: number): number {
    const el = trackRef.current;
    if (!el) return hours;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    let angle = Math.atan2(dy, dx) + Math.PI / 2; // 0 at 12 o'clock, clockwise
    if (angle < 0) angle += Math.PI * 2;
    // Undo the dial's own rotation before converting to hours, so
    // dragging onto a given color always yields the hour that color
    // actually represents.
    angle -= DIAL_ROTATION_RAD;
    if (angle < 0) angle += Math.PI * 2;
    return (angle / (Math.PI * 2)) * 24;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    onChange(angleToHours(e.clientX, e.clientY));
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    onChange(angleToHours(e.clientX, e.clientY));
  }
  function handlePointerUp() {
    draggingRef.current = false;
  }

  // Same DIAL_ROTATION_RAD applied here (added instead of subtracted —
  // this is the inverse of angleToHours) so the handle marker always
  // sits on the correct color for the current hour.
  const handleAngle = (hours / 24) * Math.PI * 2 + DIAL_ROTATION_RAD - Math.PI / 2;
  const HANDLE_RADIUS_PCT = 44;
  const handleX = 50 + HANDLE_RADIUS_PCT * Math.cos(handleAngle);
  const handleY = 50 + HANDLE_RADIUS_PCT * Math.sin(handleAngle);
  const isDaytime = hours >= 6.5 && hours <= 17.5;

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'relative',
        width: 84,
        height: 84,
        borderRadius: '50%',
        background: gradient,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3) inset',
        margin: '0 auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${handleX}%`,
          top: `${handleY}%`,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }}
      >
        {isDaytime ? '☀️' : '🌙'}
      </div>
    </div>
  );
}
