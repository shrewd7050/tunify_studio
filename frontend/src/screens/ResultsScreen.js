import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  ActivityIndicator,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { downloadFile, getAudioUrl, createAudioPlayer } from "../services/api";
import styles from "../styles/theme";

const TRACKS = [
  { key: "finalUrl", label: "Final Mix", icon: "graphic-eq" },
  { key: "autotunedUrl", label: "Auto-Tuned Vocals", icon: "mic" },
  { key: "backingUrl", label: "AI Backing Track", icon: "music-note" },
];

export default function ResultsScreen({ route, navigation }) {
  const { jobId, key, scale, duration, processingTime } = route.params;
  const availableTracks = TRACKS.filter((t) => route.params[t.key]);
  const [activeTrack, setActiveTrack] = useState(availableTracks[0]?.key || "autotunedUrl");
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
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isPlaying]);

  useEffect(() => () => { soundRef.current?.unload(); }, []);

  const loadAndPlay = async (trackKey) => {
    try {
      if (!route.params[trackKey]) return;
      if (soundRef.current) { await soundRef.current.unload(); soundRef.current = null; }
      setLoading(trackKey);
      const audioUri = getAudioUrl(route.params[trackKey]);
      const player = await createAudioPlayer(audioUri, onStatus);
      soundRef.current = player;
      setActiveTrack(trackKey);
      setIsPlaying(true);
      setLoading(null);
    } catch (err) { setLoading(null); Alert.alert("Playback Error", err.message); }
  };

  const onStatus = (s) => {
    if (s.isLoaded) {
      setPosition(s.positionMillis);
      setDurationMs(s.durationMillis || 0);
      setIsPlaying(s.isPlaying);
      if (s.didJustFinish) { setIsPlaying(false); setPosition(0); }
    }
  };

  const togglePlay = async () => {
    if (!soundRef.current) { await loadAndPlay(activeTrack); return; }
    const status = await soundRef.current.getStatus();
    if (status.isPlaying) {
      await soundRef.current.pause();
      setIsPlaying(false);
    } else {
      await soundRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (ms) => {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  };

  const progress = durationMs > 0 ? position / durationMs : 0;

  return (
    <View style={styles.resultsContainer}>
      <View style={localStyles.bgOrb1} />
      <View style={localStyles.bgOrb2} />

      <Text style={styles.resultsTitle}>Your Song is Ready</Text>
      <Text style={styles.resultsSubtitle}>
        Key: {key} {scale} | Duration: {Math.round(duration)}s{processingTime ? ` | Processed in ${processingTime}s` : ""}
      </Text>
      <View style={styles.keyBadge}>
        <Text style={styles.keyBadgeText}>{key} {scale?.toUpperCase()}</Text>
      </View>

      {/* Tracks */}
      <View style={{ marginTop: 28, gap: 10 }}>
        {availableTracks.map((t) => (
          <TouchableOpacity key={t.key} style={[localStyles.trackItem, activeTrack === t.key && localStyles.trackItemActive]} onPress={() => loadAndPlay(t.key)} disabled={loading !== null}>
            <View style={[localStyles.trackIcon, activeTrack === t.key && localStyles.trackIconActive]}>
              {loading === t.key ? <ActivityIndicator size="small" color="#A855F7" /> : <MaterialIcons name={t.icon} size={20} color={activeTrack === t.key ? "#A855F7" : "#6B7280"} />}
            </View>
            <Text style={[localStyles.trackLabel, activeTrack === t.key && localStyles.trackLabelActive]}>{t.label}</Text>
            {activeTrack === t.key && isPlaying && <MaterialIcons name="equalizer" size={18} color="#A855F7" />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Player */}
      <View style={styles.playerCard}>
        <Text style={styles.playerTitle}>{TRACKS.find((t) => t.key === activeTrack)?.label}</Text>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity style={styles.playButton} onPress={togglePlay}>
            <MaterialIcons name={isPlaying ? "pause" : "play-arrow"} size={32} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
        </View>
      </View>

      {route.params.finalUrl ? (
        <TouchableOpacity style={styles.downloadButton} onPress={async () => {
          try {
            const localUri = await downloadFile(route.params.finalUrl);
            Alert.alert("Downloaded", `Saved to: ${localUri}`);
          } catch (err) {
            Alert.alert("Download Failed", err.message || "Try again");
          }
        }}>
          <Text style={styles.downloadButtonText}>Download Final Mix</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.downloadButton} onPress={async () => {
          try {
            const localUri = await downloadFile(route.params.autotunedUrl);
            Alert.alert("Downloaded", `Saved to: ${localUri}`);
          } catch (err) {
            Alert.alert("Download Failed", err.message || "Try again");
          }
        }}>
          <Text style={styles.downloadButtonText}>Download Auto-Tuned Vocals</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={localStyles.effectsButton} onPress={() => {
        navigation.navigate("Effects", { uri: route.params.autotunedUrl, jobId: route.params.jobId });
      }}>
        <MaterialIcons name="graphic-eq" size={18} color="#22C55E" />
        <Text style={localStyles.effectsButtonText}>Apply Effects</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.retakeButton} onPress={() => navigation.popToTop()}>
        <Text style={styles.retakeText}>Record Another</Text>
      </TouchableOpacity>
    </View>
  );
}

const localStyles = StyleSheet.create({
  bgOrb1: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: "rgba(168, 85, 247, 0.05)", top: -60, left: -80 },
  bgOrb2: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(6, 182, 212, 0.04)", bottom: 150, right: -60 },
  trackItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: "rgba(168, 85, 247, 0.06)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.1)" },
  trackItemActive: { backgroundColor: "rgba(168, 85, 247, 0.12)", borderColor: "#A855F7" },
  trackIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(168, 85, 247, 0.1)", justifyContent: "center", alignItems: "center" },
  trackIconActive: { backgroundColor: "rgba(168, 85, 247, 0.2)" },
  trackLabel: { color: "#6B7280", fontSize: 14, fontWeight: "700", flex: 1 },
  trackLabelActive: { color: "#A855F7" },
  effectsButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#22C55E", borderRadius: 16, paddingVertical: 16, marginTop: 12, backgroundColor: "rgba(34, 197, 94, 0.1)" },
  effectsButtonText: { color: "#22C55E", fontSize: 16, fontWeight: "700" },
});
