import { useEffect, useRef, useState } from 'react';
import type { Shape } from '../../geometry/shape';
import type { ColorScheme, ProfileScheme } from '../../scene/Scene';

type HistoryEntry = {
  shape: Shape;
  colorScheme: ColorScheme;
  profileScheme: ProfileScheme;
};

type HistoryState = {
  entries: HistoryEntry[];
  index: number;
};

type HistoryTransaction = {
  initial: HistoryEntry;
};

export function useHistory(
  shape: Shape,
  colorScheme: ColorScheme,
  profileScheme: ProfileScheme,
  setShape: (shape: Shape) => void,
  setColorScheme: (colorScheme: ColorScheme) => void,
  setProfileScheme: (profileScheme: ProfileScheme) => void,
): {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  beginHistoryTransaction: () => void;
  commitHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
} {
  const [history, setHistory] = useState<HistoryState>(() => ({
    entries: [{ shape, colorScheme, profileScheme }],
    index: 0,
  }));

  const isUndoRedoRef = useRef(false);
  const transactionRef = useRef<HistoryTransaction | null>(null);

  const currentEntry: HistoryEntry = {
    shape,
    colorScheme,
    profileScheme,
  };

  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }

    // בזמן transaction לא יוצרים snapshots ביניים
    if (transactionRef.current) return;

    setHistory((previous) => {
      const truncated = previous.entries.slice(0, previous.index + 1);

      return {
        entries: [...truncated, currentEntry],
        index: truncated.length,
      };
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, colorScheme, profileScheme]);

  function beginHistoryTransaction() {
    if (transactionRef.current) return;

    transactionRef.current = {
      initial: {
        shape,
        colorScheme,
        profileScheme,
      },
    };
  }

  function commitHistoryTransaction() {
    const transaction = transactionRef.current;
    if (!transaction) return;

    transactionRef.current = null;

    const hasChanged =
      transaction.initial.shape !== shape ||
      transaction.initial.colorScheme !== colorScheme ||
      transaction.initial.profileScheme !== profileScheme;

    if (!hasChanged) return;

    setHistory((previous) => {
      const truncated = previous.entries.slice(0, previous.index + 1);

      return {
        entries: [...truncated, currentEntry],
        index: truncated.length,
      };
    });
  }

  function cancelHistoryTransaction() {
    const transaction = transactionRef.current;
    if (!transaction) return;

    transactionRef.current = null;

    isUndoRedoRef.current = true;

    setShape(transaction.initial.shape);
    setColorScheme(transaction.initial.colorScheme);
    setProfileScheme(transaction.initial.profileScheme);
  }

  function undo() {
    if (history.index <= 0) return;

    transactionRef.current = null;

    const newIndex = history.index - 1;
    const entry = history.entries[newIndex];

    isUndoRedoRef.current = true;

    setShape(entry.shape);
    setColorScheme(entry.colorScheme);
    setProfileScheme(entry.profileScheme);
    setHistory((previous) => ({
      ...previous,
      index: newIndex,
    }));
  }

  function redo() {
    if (history.index >= history.entries.length - 1) return;

    transactionRef.current = null;

    const newIndex = history.index + 1;
    const entry = history.entries[newIndex];

    isUndoRedoRef.current = true;

    setShape(entry.shape);
    setColorScheme(entry.colorScheme);
    setProfileScheme(entry.profileScheme);
    setHistory((previous) => ({
      ...previous,
      index: newIndex,
    }));
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

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    beginHistoryTransaction,
    commitHistoryTransaction,
    cancelHistoryTransaction,
  };
}