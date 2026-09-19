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
import { Audio } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { voiceSwap, uploadAudio, createAudioPlayer, getAudioUrl, downloadFile } from "../services/api";
import styles from "../styles/theme";

const FILES_KEY = "@tunify_files";

export default function VoiceSwapScreen({ navigation }) {
  const [originalFile, setOriginalFile] = useState(null);
  const [voiceFile, setVoiceFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [savedFiles, setSavedFiles] = useState([]);
  const [playingUrl, setPlayingUrl] = useState(null);
  const [pitchShift, setPitchShift] = useState(0);
  const soundRef = useRef(null);
  const timerRef = useRef(null);

  const STEPS = [
    "Uploading your files...",
    "Separating vocals from original song...",
    "Matching your phrase to the song (MFCC+DTW)...",
    "Converting voice & aligning pitch...",
    "Scaling pitch (lows/mids/highs)...",
    "Mixing final result...",
  ];

  useEffect(() => { loadFiles(); }, []);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (soundRef.current) { soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
    };
  }, []);

  const loadFiles = async () => {
    try {
      const json = await AsyncStorage.getItem(FILES_KEY);
      setSavedFiles(json ? JSON.parse(json) : []);
    } catch (e) {}
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  };

  const pickOriginal = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      setOriginalFile({ uri: file.uri, name: file.name });
    } catch (err) {
      Alert.alert("Error", "Failed to pick file: " + err.message);
    }
  };

  const pickVoice = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      setVoiceFile({ uri: file.uri, name: file.name });
    } catch (err) {
      Alert.alert("Error", "Failed to pick file: " + err.message);
    }
  };

  const pickFromSaved = async (which) => {
    if (savedFiles.length === 0) {
      Alert.alert("No files", "Record or upload some audio files first.");
      return;
    }
    Alert.alert(
      "Select a file",
      `Choose the ${which === "original" ? "original song" : "your voice recording"}:`,
      savedFiles.map((f) => ({
        text: f.name,
        onPress: () => {
          if (which === "original") {
            setOriginalFile({ uri: f.uri, name: f.name, savedId: f.id });
          } else {
            setVoiceFile({ uri: f.uri, name: f.name, savedId: f.id });
          }
        },
      })).concat([{ text: "Cancel", style: "cancel" }])
    );
  };

  const cancelRef = useRef(false);
  const abortRef = useRef(null);

  const handleSwap = async () => {
    if (!originalFile || !voiceFile) {
      Alert.alert("Missing files", "Please select both an original song and your voice recording.");
      return;
    }
    cancelRef.current = false;
    abortRef.current = new AbortController();
    setProcessing(true);
    setElapsed(0);
    setCurrentStep(0);
    setResult(null);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);

    try {
      setCurrentStep(1);
      const swapResult = await voiceSwap(
        originalFile.uri, originalFile.name,
        voiceFile.uri, voiceFile.name,
        { signal: abortRef.current.signal, pitch_shift: pitchShift },
      );
      if (cancelRef.current) return;
      setCurrentStep(5);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setProcessing(false);
      setResult(swapResult);
    } catch (err) {
      if (cancelRef.current || err?.name === "CanceledError" || err?.name === "AbortError") return;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const msg = err?.response?.data?.detail || err?.message || "Something went wrong";
      Alert.alert("Voice Swap Failed", msg);
      setProcessing(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      "Cancel Processing?",
      "This will stop the voice swap. The files are already uploaded but the result won't be saved.",
      [
        { text: "Keep Going", style: "cancel" },
        {
          text: "Cancel",
          style: "destructive",
          onPress: () => {
            cancelRef.current = true;
            if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            setProcessing(false);
          },
        },
      ]
    );
  };

  const playResult = async (url) => {
    const fullUrl = getAudioUrl(url);
    if (playingUrl === url && soundRef.current) {
      try { await soundRef.current.pauseAsync(); } catch (_) {}
      setPlayingUrl(null);
      soundRef.current = null;
      return;
    }
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch (_) {}
      soundRef.current = null;
    }
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: fullUrl },
        { shouldPlay: true },
        (status) => {
          if (status.didJustFinish) {
            setPlayingUrl(null);
            soundRef.current = null;
          }
        }
      );
      soundRef.current = sound;
      setPlayingUrl(url);
    } catch (err) {
      Alert.alert("Playback Error", "Could not play audio.");
      setPlayingUrl(null);
    }
  };

  if (processing) {
    return (
      <View style={localStyles.processingContainer}>
        <View style={localStyles.bgOrb1} />
        <View style={localStyles.bgOrb2} />
        <ActivityIndicator size="large" color="#F43F5E" />
        <Text style={styles.processingTitle}>Swapping Your Voice</Text>
        <Text style={{ color: "#F43F5E", fontSize: 24, fontWeight: "800", marginTop: 12, fontVariant: ["tabular-nums"] }}>
          {formatTime(elapsed)}
        </Text>
        <Text style={styles.processingSubtitle}>This may take a few minutes...</Text>
        <View style={styles.processingSteps}>
          {STEPS.map((step, i) => {
            const isActive = i === currentStep;
            const isDone = i < currentStep;
            return (
              <View key={i} style={[styles.stepRow, isActive && styles.stepRowActive, isDone && styles.stepRowDone]}>
                <View style={styles.stepIcon}>
                  {isDone ? <MaterialIcons name="check" size={16} color="#22C55E" /> : isActive ? <ActivityIndicator size="small" color="#F43F5E" /> : <Text style={{ color: "#4B5563", fontSize: 12 }}>{i + 1}</Text>}
                </View>
                <Text style={[styles.stepText, isActive && styles.stepTextActive, isDone && styles.stepTextDone]}>{step}</Text>
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={localStyles.cancelBtn}
          onPress={handleCancel}
          activeOpacity={0.7}
        >
          <MaterialIcons name="close" size={18} color="#6B7280" />
          <Text style={localStyles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (result) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 40, backgroundColor: "#0a0a12" }}>
        <View style={localStyles.bgOrb1} />
        <View style={localStyles.bgOrb2} />

        <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 24 }}>
          <MaterialIcons name="arrow-back" size={20} color="#6B7280" />
          <Text style={{ color: "#6B7280", fontSize: 14 }}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.resultsTitle}>Voice Swap Complete</Text>
        <Text style={styles.resultsSubtitle}>Your voice on the original track</Text>

        <View style={localStyles.statsRow}>
          <View style={localStyles.statBox}>
            <Text style={localStyles.statValue}>{result.key} {result.scale}</Text>
            <Text style={localStyles.statLabel}>Key</Text>
          </View>
          <View style={localStyles.statBox}>
            <Text style={localStyles.statValue}>{result.processing_time}s</Text>
            <Text style={localStyles.statLabel}>Time</Text>
          </View>
        </View>

        {result.match_confidence !== undefined && (
          <View style={localStyles.matchInfo}>
            <View style={localStyles.matchRow}>
              <MaterialIcons name={result.match_confidence >= 0.7 ? "check-circle" : result.match_confidence >= 0.4 ? "warning" : "error"} size={16} color={result.match_confidence >= 0.7 ? "#22C55E" : result.match_confidence >= 0.4 ? "#F59E0B" : "#F43F5E"} />
              <Text style={[localStyles.matchText, { color: result.match_confidence >= 0.7 ? "#22C55E" : result.match_confidence >= 0.4 ? "#F59E0B" : "#F43F5E" }]}>
                Match: {(result.match_confidence * 100).toFixed(0)}%
              </Text>
            </View>
            {result.original_start !== undefined && result.original_end !== undefined && (
              <Text style={localStyles.matchSection}>
                Original section: {formatTime(result.original_start)} → {formatTime(result.original_end)}
              </Text>
            )}
            {result.pipeline === "global_key_fallback" && (
              <Text style={[localStyles.matchSection, { color: "#F59E0B" }]}>
                Low confidence - used fallback auto-tune
              </Text>
            )}
            {result.pipeline === "melody_match_rvc" && (
              <Text style={[localStyles.matchSection, { color: "#22C55E" }]}>
                RVC voice conversion + melody match pipeline
              </Text>
            )}
          </View>
        )}

        <Text style={[styles.settingsLabel, { marginTop: 24 }]}>Results</Text>

        <TouchableOpacity style={localStyles.resultCard} onPress={() => playResult(result.voice_swapped_url)}>
          <View style={localStyles.resultIcon}>
            <MaterialIcons name="mic" size={24} color="#F43F5E" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={localStyles.resultTitle}>Voice Swap Mix</Text>
            <Text style={localStyles.resultDesc}>Your voice + original backing track</Text>
          </View>
          <MaterialIcons name={playingUrl === result.voice_swapped_url ? "pause-circle-filled" : "play-circle-filled"} size={32} color="#F43F5E" />
        </TouchableOpacity>
        <TouchableOpacity
          style={localStyles.editBtn}
          onPress={() => navigation.navigate("Studio", { uri: getAudioUrl(result.voice_swapped_url), filename: "voice_swap_mix.wav" })}
        >
          <MaterialIcons name="edit" size={16} color="#A855F7" />
          <Text style={localStyles.editBtnText}>Edit in Studio</Text>
        </TouchableOpacity>

        <TouchableOpacity style={localStyles.resultCard} onPress={() => playResult(result.tuned_voice_url)}>
          <View style={localStyles.resultIcon}>
            <MaterialIcons name="tune" size={24} color="#A855F7" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={localStyles.resultTitle}>Your Auto-Tuned Voice</Text>
            <Text style={localStyles.resultDesc}>Your voice tuned to match the song</Text>
          </View>
          <MaterialIcons name={playingUrl === result.tuned_voice_url ? "pause-circle-filled" : "play-circle-filled"} size={32} color="#A855F7" />
        </TouchableOpacity>
        <TouchableOpacity
          style={localStyles.editBtn}
          onPress={() => navigation.navigate("Studio", { uri: getAudioUrl(result.tuned_voice_url), filename: "auto_tuned_voice.wav" })}
        >
          <MaterialIcons name="edit" size={16} color="#A855F7" />
          <Text style={localStyles.editBtnText}>Edit in Studio</Text>
        </TouchableOpacity>

        <TouchableOpacity style={localStyles.resultCard} onPress={() => playResult(result.original_backing_url)}>
          <View style={localStyles.resultIcon}>
            <MaterialIcons name="library-music" size={24} color="#06B6D4" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={localStyles.resultTitle}>Original Backing Track</Text>
            <Text style={localStyles.resultDesc}>Instrumental from the original song</Text>
          </View>
          <MaterialIcons name={playingUrl === result.original_backing_url ? "pause-circle-filled" : "play-circle-filled"} size={32} color="#06B6D4" />
        </TouchableOpacity>
        <TouchableOpacity
          style={localStyles.editBtn}
          onPress={() => navigation.navigate("Studio", { uri: getAudioUrl(result.original_backing_url), filename: "backing_track.wav" })}
        >
          <MaterialIcons name="edit" size={16} color="#A855F7" />
          <Text style={localStyles.editBtnText}>Edit in Studio</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
          <TouchableOpacity
            style={[localStyles.downloadBtn, { flex: 1 }]}
            onPress={() => downloadFile(result.voice_swapped_url)}
          >
            <MaterialIcons name="download" size={18} color="#fff" />
            <Text style={localStyles.downloadBtnText}>Download Mix</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[localStyles.downloadBtn, { flex: 1, backgroundColor: "rgba(168, 85, 247, 0.2)" }]}
            onPress={() => downloadFile(result.tuned_voice_url)}
          >
            <MaterialIcons name="download" size={18} color="#A855F7" />
            <Text style={[localStyles.downloadBtnText, { color: "#A855F7" }]}>Download Voice</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[localStyles.downloadBtn, { flexDirection: "row", marginTop: 10, backgroundColor: "rgba(6, 182, 212, 0.15)" }]}
          onPress={() => downloadFile(result.original_backing_url)}
        >
          <MaterialIcons name="download" size={18} color="#06B6D4" />
          <Text style={[localStyles.downloadBtnText, { color: "#06B6D4" }]}>Download Backing Track</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 16, marginTop: 12 }}
          onPress={() => { setResult(null); setOriginalFile(null); setVoiceFile(null); setProcessing(false); }}
        >
          <MaterialIcons name="refresh" size={18} color="#6B7280" />
          <Text style={{ color: "#6B7280", fontSize: 14, fontWeight: "600" }}>Start Over</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 40, backgroundColor: "#0a0a12" }}>
      <View style={localStyles.bgOrb1} />
      <View style={localStyles.bgOrb2} />

      <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 24 }}>
        <MaterialIcons name="arrow-back" size={20} color="#6B7280" />
        <Text style={{ color: "#6B7280", fontSize: 14 }}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.resultsTitle}>Voice Swap</Text>
      <Text style={styles.resultsSubtitle}>Put your voice on any song. Upload the original track and your voice recording.</Text>

      {/* ORIGINAL SONG */}
      <Text style={[styles.settingsLabel, { marginTop: 28, marginBottom: 12 }]}>
        <MaterialIcons name="library-music" size={14} color="#06B6D4" /> Original Song
      </Text>
      <TouchableOpacity style={localStyles.uploadCard} onPress={pickOriginal} activeOpacity={0.7}>
        <View style={[localStyles.uploadIcon, { backgroundColor: "rgba(6, 182, 212, 0.12)", borderColor: "rgba(6, 182, 212, 0.25)" }]}>
          <MaterialIcons name={originalFile ? "check-circle" : "add-circle-outline"} size={28} color="#06B6D4" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={localStyles.uploadTitle}>
            {originalFile ? originalFile.name : "Select original song"}
          </Text>
          <Text style={localStyles.uploadDesc}>
            {originalFile ? "Tap to change" : "The song you want to cover"}
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={20} color="#4B5563" />
      </TouchableOpacity>
      <TouchableOpacity style={localStyles.savedBtn} onPress={() => pickFromSaved("original")}>
        <MaterialIcons name="folder-open" size={14} color="#6B7280" />
        <Text style={localStyles.savedBtnText}>Choose from My Files</Text>
      </TouchableOpacity>

      {/* VOICE RECORDING */}
      <Text style={[styles.settingsLabel, { marginTop: 28, marginBottom: 12 }]}>
        <MaterialIcons name="mic" size={14} color="#F43F5E" /> Your Voice
      </Text>
      <TouchableOpacity style={localStyles.uploadCard} onPress={pickVoice} activeOpacity={0.7}>
        <View style={[localStyles.uploadIcon, { backgroundColor: "rgba(244, 63, 94, 0.12)", borderColor: "rgba(244, 63, 94, 0.25)" }]}>
          <MaterialIcons name={voiceFile ? "check-circle" : "add-circle-outline"} size={28} color="#F43F5E" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={localStyles.uploadTitle}>
            {voiceFile ? voiceFile.name : "Select your voice recording"}
          </Text>
          <Text style={localStyles.uploadDesc}>
            {voiceFile ? "Tap to change" : "Your vocal recording (any length)"}
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={20} color="#4B5563" />
      </TouchableOpacity>
      <TouchableOpacity style={localStyles.savedBtn} onPress={() => pickFromSaved("voice")}>
        <MaterialIcons name="folder-open" size={14} color="#6B7280" />
        <Text style={localStyles.savedBtnText}>Choose from My Files</Text>
      </TouchableOpacity>

      {/* HOW IT WORKS */}
      <View style={localStyles.howItWorks}>
        <Text style={localStyles.howTitle}>How it works</Text>
        <View style={localStyles.howStep}>
          <View style={[localStyles.howNum, { backgroundColor: "rgba(6, 182, 212, 0.2)" }]}>
            <Text style={[localStyles.howNumText, { color: "#06B6D4" }]}>1</Text>
          </View>
          <Text style={localStyles.howText}>AI separates vocals from the original song</Text>
        </View>
        <View style={localStyles.howStep}>
          <View style={[localStyles.howNum, { backgroundColor: "rgba(168, 85, 247, 0.2)" }]}>
            <Text style={[localStyles.howNumText, { color: "#A855F7" }]}>2</Text>
          </View>
          <Text style={localStyles.howText}>MFCC+DTW matches your phrase to the song section</Text>
        </View>
        <View style={localStyles.howStep}>
          <View style={[localStyles.howNum, { backgroundColor: "rgba(244, 63, 94, 0.2)" }]}>
            <Text style={[localStyles.howNumText, { color: "#F43F5E" }]}>3</Text>
          </View>
          <Text style={localStyles.howText}>Voice timbre converted & pitch scaled (lows/mids/highs)</Text>
        </View>
        <View style={localStyles.howStep}>
          <View style={[localStyles.howNum, { backgroundColor: "rgba(34, 197, 94, 0.2)" }]}>
            <Text style={[localStyles.howNumText, { color: "#22C55E" }]}>4</Text>
          </View>
          <Text style={localStyles.howText}>Mixed with beat-aware backing & professional mastering</Text>
        </View>
      </View>

      {/* PITCH SHIFT */}
      <View style={localStyles.pitchSection}>
        <View style={localStyles.pitchHeader}>
          <MaterialIcons name="tune" size={14} color="#A855F7" />
          <Text style={[styles.settingsLabel, { marginTop: 0, marginBottom: 0 }]}>
            Pitch Shift: {pitchShift > 0 ? `+${pitchShift}` : pitchShift} semitones
          </Text>
        </View>
        <Text style={localStyles.pitchDesc}>Adjust if your voice is higher or lower than the original singer</Text>
        <View style={localStyles.pitchRow}>
          <TouchableOpacity
            style={localStyles.pitchBtn}
            onPress={() => setPitchShift(Math.max(-6, pitchShift - 1))}
          >
            <MaterialIcons name="remove" size={18} color="#A855F7" />
          </TouchableOpacity>
          <View style={localStyles.pitchTrack}>
            {[-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6].map(v => (
              <TouchableOpacity
                key={v}
                onPress={() => setPitchShift(v)}
                style={[
                  localStyles.pitchDot,
                  v === pitchShift && localStyles.pitchDotActive,
                  v === 0 && localStyles.pitchDotZero,
                ]}
              />
            ))}
          </View>
          <TouchableOpacity
            style={localStyles.pitchBtn}
            onPress={() => setPitchShift(Math.min(6, pitchShift + 1))}
          >
            <MaterialIcons name="add" size={18} color="#A855F7" />
          </TouchableOpacity>
        </View>
      </View>

      {/* PROCESS BUTTON */}
      <TouchableOpacity
        style={[localStyles.processBtn, { marginTop: 32 }, (!originalFile || !voiceFile) && localStyles.processBtnDisabled]}
        onPress={handleSwap}
        disabled={!originalFile || !voiceFile}
        activeOpacity={0.8}
      >
        <MaterialIcons name="swap-horiz" size={22} color="#fff" />
        <Text style={localStyles.processBtnText}>Swap My Voice</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const localStyles = StyleSheet.create({
  bgOrb1: { position: "absolute", width: 250, height: 250, borderRadius: 125, backgroundColor: "rgba(244, 63, 94, 0.05)", top: -60, right: -80 },
  bgOrb2: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(6, 182, 212, 0.04)", bottom: 100, left: -60 },

  uploadCard: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 16,
    backgroundColor: "rgba(168, 85, 247, 0.05)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)",
  },
  uploadIcon: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  uploadTitle: { color: "#E5E7EB", fontSize: 14, fontWeight: "700" },
  uploadDesc: { color: "#6B7280", fontSize: 11, marginTop: 2 },

  savedBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, marginTop: 6 },
  savedBtnText: { color: "#6B7280", fontSize: 12, fontWeight: "600" },

  howItWorks: {
    marginTop: 28, padding: 16, backgroundColor: "rgba(168, 85, 247, 0.04)",
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.08)",
  },
  howTitle: { color: "#E5E7EB", fontSize: 14, fontWeight: "700", marginBottom: 12 },
  howStep: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  howNum: { width: 28, height: 28, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  howNumText: { fontSize: 13, fontWeight: "800" },
  howText: { color: "#9CA3AF", fontSize: 12, flex: 1 },

  pitchSection: {
    marginTop: 20, padding: 16, backgroundColor: "rgba(168, 85, 247, 0.04)",
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.08)",
  },
  pitchHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  pitchDesc: { color: "#6B7280", fontSize: 11, marginTop: 6, marginBottom: 12 },
  pitchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pitchBtn: {
    width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center",
    backgroundColor: "rgba(168, 85, 247, 0.12)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.25)",
  },
  pitchTrack: { flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pitchDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(168, 85, 247, 0.2)",
  },
  pitchDotActive: {
    backgroundColor: "#A855F7", width: 14, height: 14, borderRadius: 7,
    shadowColor: "#A855F7", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6,
  },
  pitchDotZero: {
    backgroundColor: "rgba(168, 85, 247, 0.4)",
  },

  processBtn: {
    backgroundColor: "#F43F5E", borderRadius: 16, paddingVertical: 18,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    shadowColor: "#F43F5E", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
  },
  processBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },
  processBtnText: { color: "#fff", fontSize: 17, fontWeight: "800" },

  processingContainer: { flex: 1, backgroundColor: "#0a0a12", justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },

  cancelBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, paddingHorizontal: 24, marginTop: 32,
    borderRadius: 12, backgroundColor: "rgba(107, 114, 128, 0.1)",
    borderWidth: 1, borderColor: "rgba(107, 114, 128, 0.2)",
  },
  cancelBtnText: { color: "#6B7280", fontSize: 14, fontWeight: "600" },

  statsRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  statBox: {
    flex: 1, alignItems: "center", padding: 14, backgroundColor: "rgba(168, 85, 247, 0.06)",
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.1)",
  },
  statValue: { color: "#E5E7EB", fontSize: 18, fontWeight: "800" },
  statLabel: { color: "#6B7280", fontSize: 11, marginTop: 4, fontWeight: "600" },

  matchInfo: { marginTop: 12, padding: 12, backgroundColor: "rgba(168, 85, 247, 0.06)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)" },
  matchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  matchText: { fontSize: 13, fontWeight: "700" },
  matchSection: { color: "#9CA3AF", fontSize: 11, marginTop: 4, fontFamily: "monospace" },

  resultCard: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 16, marginBottom: 10,
    backgroundColor: "rgba(168, 85, 247, 0.06)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.1)",
  },
  resultIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(244, 63, 94, 0.12)", justifyContent: "center", alignItems: "center" },
  resultTitle: { color: "#E5E7EB", fontSize: 14, fontWeight: "700" },
  resultDesc: { color: "#6B7280", fontSize: 11, marginTop: 2 },

  editBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, marginTop: -4, marginBottom: 10 },
  editBtnText: { color: "#A855F7", fontSize: 12, fontWeight: "700" },

  downloadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: "#F43F5E",
  },
  downloadBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
