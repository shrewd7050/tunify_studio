import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
} from "react-native";
import { Audio } from "expo-av";
import { MaterialIcons } from "@expo/vector-icons";
import { downloadFile } from "../services/api";
import styles from "../styles/theme";

const TRACKS = [
  { key: "autotunedUrl", label: "Auto-Tuned Vocals", icon: "mic" },
  { key: "backingUrl", label: "AI Backing Track", icon: "music-note" },
  { key: "finalUrl", label: "Final Mix", icon: "graphic-eq" },
];

export default function ResultsScreen({ route, navigation }) {
  const { jobId, key, scale, duration, autotunedUrl, backingUrl, finalUrl } =
    route.params;

  const [activeTrack, setActiveTrack] = useState("finalUrl");
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [loading, setLoading] = useState(null);

  const soundRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const loadAndPlay = async (trackKey) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      setLoading(trackKey);
      const localUri = await downloadFile(route.params[trackKey]);

      const { sound } = await Audio.Sound.createAsync(
        { uri: localUri },
        { shouldPlay: true },
        onPlaybackStatusUpdate
      );

      soundRef.current = sound;
      setActiveTrack(trackKey);
      setIsPlaying(true);
      setLoading(null);
    } catch (err) {
      setLoading(null);
      Alert.alert("Playback Error", err.message);
    }
  };

  const onPlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      setPosition(status.positionMillis);
      setDurationMs(status.durationMillis || 0);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
      }
    }
  };

  const togglePlay = async () => {
    if (!soundRef.current) {
      await loadAndPlay(activeTrack);
      return;
    }

    if (isPlaying) {
      await soundRef.current.pauseAsync();
    } else {
      await soundRef.current.playAsync();
    }
  };

  const seekTo = async (fraction) => {
    if (soundRef.current && durationMs > 0) {
      await soundRef.current.setPositionAsync(fraction * durationMs);
    }
  };

  const formatTime = (ms) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const progress = durationMs > 0 ? position / durationMs : 0;

  return (
    <View style={styles.resultsContainer}>
      {/* Header */}
      <Text style={styles.resultsTitle}>Your Song is Ready</Text>
      <Text style={styles.resultsSubtitle}>
        Key detected: {key} {scale} | Duration: {Math.round(duration)}s
      </Text>
      <View style={styles.keyBadge}>
        <Text style={styles.keyBadgeText}>
          {key} {scale?.toUpperCase()}
        </Text>
      </View>

      {/* Track Selection */}
      <View style={{ marginTop: 30, gap: 10 }}>
        {TRACKS.map((track) => (
          <TouchableOpacity
            key={track.key}
            style={[
              localStyles.trackItem,
              activeTrack === track.key && localStyles.trackItemActive,
            ]}
            onPress={() => loadAndPlay(track.key)}
            disabled={loading !== null}
          >
            <View
              style={[
                localStyles.trackIcon,
                activeTrack === track.key && localStyles.trackIconActive,
              ]}
            >
              {loading === track.key ? (
                <ActivityIndicator size="small" color="#0a0a0a" />
              ) : (
                <MaterialIcons
                  name={track.icon}
                  size={20}
                  color={activeTrack === track.key ? "#0a0a0a" : "#888"}
                />
              )}
            </View>
            <Text
              style={[
                localStyles.trackLabel,
                activeTrack === track.key && localStyles.trackLabelActive,
              ]}
            >
              {track.label}
            </Text>
            {activeTrack === track.key && isPlaying && (
              <MaterialIcons name="equalizer" size={18} color="#0a0a0a" />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Player */}
      <View style={styles.playerCard}>
        <Text style={styles.playerTitle}>
          {TRACKS.find((t) => t.key === activeTrack)?.label}
        </Text>

        {/* Play Button */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity style={styles.playButton} onPress={togglePlay}>
            <MaterialIcons
              name={isPlaying ? "pause" : "play-arrow"}
              size={32}
              color="#0a0a0a"
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Progress Bar */}
        <TouchableOpacity
          style={styles.progressBar}
          onPress={(e) => {
            const x = e.nativeEvent.locationX;
            const width = e.currentTarget.props?.style?.width || 300;
            seekTo(Math.max(0, Math.min(1, x / 300)));
          }}
        >
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </TouchableOpacity>

        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
        </View>
      </View>

      {/* Actions */}
      <TouchableOpacity
        style={styles.downloadButton}
        onPress={() => Alert.alert("Download", "File saved to device")}
      >
        <Text style={styles.downloadButtonText}>Download Final Mix</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.retakeButton}
        onPress={() => navigation.popToTop()}
      >
        <Text style={styles.retakeText}>Record Another</Text>
      </TouchableOpacity>
    </View>
  );
}

const localStyles = StyleSheet.create({
  trackItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    backgroundColor: "#111",
    borderRadius: 14,
  },
  trackItemActive: {
    backgroundColor: "#00FF88",
  },
  trackIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
  },
  trackIconActive: {
    backgroundColor: "#0a1a10",
  },
  trackLabel: {
    color: "#ccc",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  trackLabelActive: {
    color: "#0a0a0a",
  },
});
