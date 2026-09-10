import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { applyEffects, downloadFile, uploadAudio, getAudioUrl, createAudioPlayer } from "../services/api";

const EFFECTS = [
  { id: "reverb", label: "Reverb", icon: "surround-sound", color: "#A855F7", desc: "Add spatial depth" },
  { id: "echo", label: "Echo", icon: "graphic-eq", color: "#06B6D4", desc: "Delay repeats" },
  { id: "chorus", label: "Chorus", icon: "groups", color: "#22C55E", desc: "Thicken the sound" },
  { id: "distortion", label: "Distortion", icon: "bolt", color: "#F43F5E", desc: "Gritty overdrive" },
  { id: "lowpass", label: "Low Pass", icon: "filter-drama", color: "#F59E0B", desc: "Remove highs" },
  { id: "highpass", label: "High Pass", icon: "filter-list", color: "#EC4899", desc: "Remove lows" },
  { id: "compressor", label: "Compress", icon: "compress", color: "#8B5CF6", desc: "Even out volume" },
  { id: "pitch_up", label: "Pitch Up", icon: "arrow-upward", color: "#10B981", desc: "+2 semitones" },
  { id: "pitch_down", label: "Pitch Down", icon: "arrow-downward", color: "#EF4444", desc: "-2 semitones" },
  { id: "speed_up", label: "Speed Up", icon: "fast-forward", color: "#F97316", desc: "1.2x speed" },
  { id: "slow_down", label: "Slow Down", icon: "fast-rewind", color: "#6366F1", desc: "0.8x speed" },
];

export default function EffectsScreen({ route, navigation }) {
  const { uri, jobId } = route.params || {};
  const [selectedEffects, setSelectedEffects] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const soundRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  };

  const toggleEffect = (id) => {
    setSelectedEffects((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const handleApply = async () => {
    if (selectedEffects.length === 0) {
      Alert.alert("Select effects", "Pick at least one effect to apply.");
      return;
    }
    if (!jobId) {
      Alert.alert("No file", "Upload or record a file first.");
      return;
    }

    setProcessing(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const effectsPayload = selectedEffects.map((name) => ({ name, params: {} }));
      const result = await applyEffects(jobId, effectsPayload);
      setResultUrl(result.effects_url);
    } catch (err) {
      Alert.alert("Failed", err.message || "Could not apply effects");
    } finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setProcessing(false);
    }
  };

  const playResult = async () => {
    try {
      if (soundRef.current) {
        const status = await soundRef.current.getStatus();
        if (status.isPlaying) {
          await soundRef.current.pause();
          setIsPlaying(false);
          return;
        } else if (status.isLoaded) {
          await soundRef.current.play();
          setIsPlaying(true);
          return;
        }
      }
      const audioUri = getAudioUrl(resultUrl);
      const player = await createAudioPlayer(audioUri, (s) => {
        if (s.didJustFinish) {
          setIsPlaying(false);
          soundRef.current = null;
        }
      });
      soundRef.current = player;
      setIsPlaying(true);
    } catch (err) {
      Alert.alert("Error", err.message);
    }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.bgOrb1} />
      <View style={s.bgOrb2} />

      <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
        <MaterialIcons name="arrow-back" size={20} color="#6B7280" />
        <Text style={s.backText}>Back</Text>
      </TouchableOpacity>

      <Text style={s.title}>Audio Effects</Text>
      <Text style={s.subtitle}>Select effects to apply to your track</Text>

      <View style={s.effectsGrid}>
        {EFFECTS.map((fx) => {
          const active = selectedEffects.includes(fx.id);
          return (
            <TouchableOpacity
              key={fx.id}
              style={[s.effectCard, active && { borderColor: fx.color, backgroundColor: fx.color + "15" }]}
              onPress={() => toggleEffect(fx.id)}
              activeOpacity={0.7}
            >
              <View style={[s.effectIcon, { backgroundColor: fx.color + "20" }, active && { backgroundColor: fx.color + "40" }]}>
                <MaterialIcons name={fx.icon} size={24} color={active ? fx.color : "#6B7280"} />
              </View>
              <Text style={[s.effectLabel, active && { color: fx.color }]}>{fx.label}</Text>
              <Text style={s.effectDesc}>{fx.desc}</Text>
              {active && (
                <View style={[s.checkmark, { backgroundColor: fx.color }]}>
                  <MaterialIcons name="check" size={12} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedEffects.length > 0 && (
        <Text style={s.selectionText}>{selectedEffects.length} effect{selectedEffects.length > 1 ? "s" : ""} selected</Text>
      )}

      {selectedEffects.length === 0 && (
        <Text style={s.hintText}>Tap effects above to select them</Text>
      )}

      {!jobId && (
        <Text style={s.errorText}>No file loaded. Record or upload audio first.</Text>
      )}

      <TouchableOpacity
        style={[s.applyBtn, (processing || selectedEffects.length === 0 || !jobId) && s.applyBtnDisabled]}
        onPress={handleApply}
        disabled={processing || selectedEffects.length === 0 || !jobId}
        activeOpacity={0.8}
      >
        {processing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <MaterialIcons name="auto-fix-high" size={20} color="#fff" />
            <Text style={s.applyBtnText}>Apply Effects</Text>
          </>
        )}
      </TouchableOpacity>

      {processing && (
        <View style={{ alignItems: "center", marginTop: 16 }}>
          <Text style={{ color: "#A855F7", fontSize: 22, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
            {formatTime(elapsed)}
          </Text>
          <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 4 }}>
            Applying {selectedEffects.length} effect{selectedEffects.length > 1 ? "s" : ""}...
          </Text>
        </View>
      )}

      {resultUrl && (
        <View style={s.resultCard}>
          <MaterialIcons name="check-circle" size={36} color="#22C55E" />
          <Text style={s.resultTitle}>Effects Applied!</Text>
          <TouchableOpacity style={s.playBtn} onPress={playResult}>
            <MaterialIcons name={isPlaying ? "pause" : "play-arrow"} size={28} color="#fff" />
          </TouchableOpacity>
          <View style={s.resultActions}>
            <TouchableOpacity
              style={s.moreEffectsBtn}
              onPress={() => {
                setResultUrl(null);
                setSelectedEffects([]);
                setIsPlaying(false);
                if (soundRef.current) { soundRef.current.unload(); soundRef.current = null; }
              }}
            >
              <MaterialIcons name="add-circle-outline" size={18} color="#A855F7" />
              <Text style={s.moreEffectsBtnText}>Apply More Effects</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.processBtn}
              onPress={() => navigation.navigate("Process", { uri: resultUrl, duration: 0, lyrics: "", jobId, fromUpload: true })}
            >
              <MaterialIcons name="auto-fix-high" size={18} color="#06B6D4" />
              <Text style={s.processBtnText}>Auto-Tune & Mix</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={s.doneBtn}
            onPress={() => navigation.popToTop()}
          >
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a12" },
  content: { padding: 24, paddingTop: 50, paddingBottom: 40 },
  bgOrb1: { position: "absolute", width: 250, height: 250, borderRadius: 125, backgroundColor: "rgba(168, 85, 247, 0.05)", top: -60, right: -80 },
  bgOrb2: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(6, 182, 212, 0.04)", bottom: 100, left: -60 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 24 },
  backText: { color: "#6B7280", fontSize: 14 },
  title: { color: "#fff", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "#6B7280", fontSize: 13, marginTop: 6 },
  effectsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 24 },
  effectCard: {
    width: "31%", alignItems: "center", paddingVertical: 16, paddingHorizontal: 4,
    borderRadius: 16, backgroundColor: "rgba(168, 85, 247, 0.05)",
    borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)", gap: 4, position: "relative",
  },
  effectIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: "center", alignItems: "center", marginBottom: 4 },
  effectLabel: { color: "#E5E7EB", fontSize: 11, fontWeight: "700" },
  effectDesc: { color: "#6B7280", fontSize: 9, fontWeight: "500" },
  checkmark: { position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 9, justifyContent: "center", alignItems: "center" },
  selectionText: { color: "#A855F7", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 16 },
  hintText: { color: "#6B7280", fontSize: 13, fontWeight: "500", textAlign: "center", marginTop: 12 },
  errorText: { color: "#F43F5E", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 12 },
  applyBtn: {
    backgroundColor: "#7C3AED", borderRadius: 16, paddingVertical: 16,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    marginTop: 20, shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
  },
  applyBtnDisabled: { opacity: 0.5 },
  applyBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  resultCard: {
    backgroundColor: "rgba(34, 197, 94, 0.08)", borderWidth: 1, borderColor: "rgba(34, 197, 94, 0.3)",
    borderRadius: 20, padding: 24, marginTop: 20, alignItems: "center", gap: 12,
  },
  resultTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  playBtn: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: "#A855F7",
    justifyContent: "center", alignItems: "center", marginTop: 8,
  },
  doneBtn: { paddingVertical: 10, paddingHorizontal: 32, borderRadius: 12, backgroundColor: "rgba(168, 85, 247, 0.15)", borderWidth: 1, borderColor: "#A855F7", marginTop: 4 },
  doneBtnText: { color: "#A855F7", fontSize: 14, fontWeight: "700" },
  resultActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  moreEffectsBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "rgba(168, 85, 247, 0.12)", borderWidth: 1, borderColor: "#A855F7" },
  moreEffectsBtnText: { color: "#A855F7", fontSize: 13, fontWeight: "700" },
  processBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "rgba(6, 182, 212, 0.12)", borderWidth: 1, borderColor: "#06B6D4" },
  processBtnText: { color: "#06B6D4", fontSize: 13, fontWeight: "700" },
});
