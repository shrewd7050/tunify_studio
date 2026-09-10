import { useState, useCallback, useRef } from "react";

export function useEditHistory(maxSize = 50) {
  const [history, setHistory] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const historyRef = useRef([]);
  const indexRef = useRef(-1);

  const pushState = useCallback(
    (state) => {
      const newHistory = historyRef.current.slice(0, indexRef.current + 1);
      newHistory.push({ ...state, timestamp: Date.now() });
      if (newHistory.length > maxSize) newHistory.shift();
      historyRef.current = newHistory;
      indexRef.current = newHistory.length - 1;
      setHistory([...newHistory]);
      setCurrentIndex(indexRef.current);
    },
    [maxSize]
  );

  const undo = useCallback(() => {
    if (indexRef.current > 0) {
      indexRef.current -= 1;
      setCurrentIndex(indexRef.current);
      return historyRef.current[indexRef.current];
    }
    return null;
  }, []);

  const redo = useCallback(() => {
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current += 1;
      setCurrentIndex(indexRef.current);
      return historyRef.current[indexRef.current];
    }
    return null;
  }, []);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const clear = useCallback(() => {
    historyRef.current = [];
    indexRef.current = -1;
    setHistory([]);
    setCurrentIndex(-1);
  }, []);

  return {
    pushState,
    undo,
    redo,
    canUndo,
    canRedo,
    history,
    currentIndex,
    clear,
  };
}
