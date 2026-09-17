import { useEffect, useRef, useState } from 'react';
import type { Shape } from '../../geometry/shape';
import type { ColorScheme, ProfileScheme } from '../../scene/Scene';

/**
 * Undo/redo — covers everything in shape + colorScheme (lengths, heights,
 * legs, junctions, post/board colors). Every change to either pushes a
 * new snapshot, except when the change came FROM undo/redo itself
 * (isUndoRedoRef guards against re-recording that as a new step).
 *
 * Also wires the global Ctrl/Cmd+Z / Ctrl/Cmd+Y (or Shift+Z) keyboard
 * shortcuts to undo/redo — kept here rather than in App() since it has no
 * other reason to exist outside this hook and needs a fresh closure over
 * undo/redo on every history change, exactly like the effect below.
 *
 * shape/colorScheme/profileScheme are owned by the caller (App) — this
 * hook only WATCHES them (to record snapshots) and CALLS BACK into the
 * three setters to restore a snapshot on undo/redo. It does not own that
 * state itself.
 */
export function useHistory(
  shape: Shape,
  colorScheme: ColorScheme,
  profileScheme: ProfileScheme,
  setShape: (shape: Shape) => void,
  setColorScheme: (colorScheme: ColorScheme) => void,
  setProfileScheme: (profileScheme: ProfileScheme) => void,
): { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean } {
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

  return { undo, redo, canUndo, canRedo };
}
