import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  PanResponder,
  Dimensions,
  StyleSheet,
  Text,
} from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function WaveformEditor({
  waveform = [],
  duration = 0,
  totalSamples = 0,
  selectionStart = null,
  selectionEnd = null,
  onSelectionChange,
  playheadPosition = null,
  style,
}) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(SCREEN_WIDTH - 48);
  const [localSelStart, setLocalSelStart] = useState(null);
  const [localSelEnd, setLocalSelEnd] = useState(null);
  const [dragging, setDragging] = useState(null);

  const selStart = selectionStart !== null ? selectionStart : localSelStart;
  const selEnd = selectionEnd !== null ? selectionEnd : localSelEnd;

  const timeToX = useCallback(
    (time) => {
      if (!duration) return 0;
      return (time / duration) * containerWidth;
    },
    [duration, containerWidth]
  );

  const xToTime = useCallback(
    (x) => {
      if (!containerWidth) return 0;
      return Math.max(0, Math.min(duration, (x / containerWidth) * duration));
    },
    [duration, containerWidth]
  );

  const onLayout = useCallback((e) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const time = xToTime(x);
        setDragging("start");
        setLocalSelStart(time);
        setLocalSelEnd(time);
        if (onSelectionChange) onSelectionChange(time, time);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const time = xToTime(x);
        if (dragging === "start" || dragging === "move") {
          setLocalSelEnd(time);
          if (onSelectionChange) {
            const s = localSelStart !== null ? localSelStart : time;
            onSelectionChange(Math.min(s, time), Math.max(s, time));
          }
        }
      },
      onPanResponderRelease: () => {
        setDragging(null);
      },
    })
  ).current;

  if (!waveform || waveform.length === 0) {
    return (
      <View style={[styles.container, style]} onLayout={onLayout}>
        <Text style={styles.emptyText}>No waveform data</Text>
      </View>
    );
  }

  const maxVal = Math.max(...waveform, 0.01);
  const barWidth = Math.max(1, containerWidth / waveform.length - 1);
  const selX1 = selStart !== null ? timeToX(selStart) : 0;
  const selX2 = selEnd !== null ? timeToX(selEnd) : 0;
  const selLeft = Math.min(selX1, selX2);
  const selWidth = Math.abs(selX2 - selX1);
  const hasSelection = selStart !== null && selEnd !== null && Math.abs(selEnd - selStart) > 0.01;

  return (
    <View style={[styles.container, style]} onLayout={onLayout} ref={containerRef}>
      <View style={styles.waveformRow} {...panResponder.panHandlers}>
        {waveform.map((val, i) => {
          const barHeight = Math.max(2, (val / maxVal) * 70);
          const x = (i / waveform.length) * containerWidth;
          const time = xToTime(x);
          const inSelection = hasSelection && time >= Math.min(selStart, selEnd) && time <= Math.max(selStart, selEnd);
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  width: barWidth,
                  height: barHeight,
                  backgroundColor: inSelection ? "#A855F7" : "rgba(168, 85, 247, 0.35)",
                  position: "absolute",
                  left: x,
                  bottom: 35 - barHeight / 2,
                },
              ]}
            />
          );
        })}
      </View>

      {hasSelection && (
        <View
          style={[
            styles.selection,
            {
              left: selLeft,
              width: selWidth,
            },
          ]}
        />
      )}

      {playheadPosition !== null && (
        <View
          style={[
            styles.playhead,
            { left: timeToX(playheadPosition) },
          ]}
        />
      )}

      <View style={styles.timeAxis}>
        {Array.from({ length: 7 }).map((_, i) => {
          const t = (i / 6) * duration;
          return (
            <Text key={i} style={styles.timeLabel}>
              {formatTime(t)}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function formatTime(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: {
    height: 110,
    backgroundColor: "rgba(168, 85, 247, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.12)",
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  waveformRow: {
    flex: 1,
    position: "relative",
  },
  bar: {
    borderRadius: 1,
  },
  selection: {
    position: "absolute",
    top: 0,
    bottom: 22,
    backgroundColor: "rgba(168, 85, 247, 0.2)",
    borderWidth: 1,
    borderColor: "#A855F7",
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 22,
    width: 2,
    backgroundColor: "#06B6D4",
  },
  timeAxis: {
    height: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    alignItems: "center",
    backgroundColor: "rgba(168, 85, 247, 0.04)",
  },
  timeLabel: {
    color: "#6B7280",
    fontSize: 9,
    fontFamily: "monospace",
  },
  emptyText: {
    color: "#6B7280",
    fontSize: 13,
    textAlign: "center",
    marginTop: 30,
  },
});
