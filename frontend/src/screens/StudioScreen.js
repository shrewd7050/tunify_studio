import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import WaveformEditor from "../components/WaveformEditor";
import { useEditHistory } from "../hooks/useEditHistory";
import {
  getAudioUrl,
  createAudioPlayer,
  uploadAudio,
  editorCut,
  editorTrim,
  editorReverse,
  editorSilence,
  editorNormalize,
  editorFade,
  editorEffectRegion,
} from "../services/api";

const TOOLS = [
  { id: "cut", label: "Cut", icon: "content-cut", color: "#F43F5E", desc: "Remove region" },
  { id: "trim", label: "Trim", icon: "crop", color: "#F59E0B", desc: "Keep region" },
  { id: "reverse", label: "Reverse", icon: "flip", color: "#8B5CF6", desc: "Reverse audio" },
  { id: "silence", label: "Silence", icon: "volume-off", color: "#6366F1", desc: "Silence region" },
  { id: "normalize", label: "Normalize", icon: "equalizer", color: "#10B981", desc: "Normalize volume" },
  { id: "fade_in", label: "Fade In", icon: "trending-up", color: "#06B6D4", desc: "Fade in" },
  { id: "fade_out", label: "Fade Out", icon: "trending-down", color: "#06B6D4", desc: "Fade out" },
];

const EFFECTS = [
  { id: "reverb", label: "Reverb", icon: "surround-sound", color: "#A855F7" },
  { id: "echo", label: "Echo", icon: "graphic-eq", color: "#06B6D4" },
  { id: "chorus", label: "Chorus", icon: "groups", color: "#22C55E" },
  { id: "distortion", label: "Distortion", icon: "bolt", color: "#F43F5E" },
  { id: "lowpass", label: "Low Pass", icon: "filter-drama", color: "#F59E0B" },
  { id: "highpass", label: "High Pass", icon: "filter-list", color: "#EC4899" },
  { id: "compressor", label: "Compress", icon: "compress", color: "#8B5CF6" },
  { id: "pitch_up", label: "Pitch +", icon: "arrow-upward", color: "#10B981" },
  { id: "pitch_down", label: "Pitch -", icon: "arrow-downward", color: "#EF4444" },
  { id: "speed_up", label: "Speed +", icon: "fast-forward", color: "#F97316" },
  { id: "slow_down", label: "Speed -", icon: "fast-rewind", color: "#6366F1" },
];

export default function StudioScreen({ route, navigation }) {
  const { uri, jobId: initialJobId, filename } = route.params || {};
  const [jobId, setJobId] = useState(initialJobId || null);
  const [waveform, setWaveform] = useState([]);
  const [duration, setDuration] = useState(0);
  const [totalSamples, setTotalSamples] = useState(0);
  const [selStart, setSelStart] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const [showEffectsModal, setShowEffectsModal] = useState(false);
  const [audioInfo, setAudioInfo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadPos, setPlayheadPos] = useState(null);
  const [editCount, setEditCount] = useState(0);
  const soundRef = useRef(null);
  const playIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const { pushState, undo, redo, canUndo, canRedo, clear } = useEditHistory(50);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      setProcessing(true);
      try {
        const uploadResult = await uploadAudio(file.uri, file.name);
        setJobId(uploadResult.job_id);
      } catch (err) {
        Alert.alert("Upload failed", err.message || "Could not upload file");
      } finally {
        setProcessing(false);
      }
    } catch (err) {
      Alert.alert("Error", "Failed to pick file: " + err.message);
    }
  };

  useEffect(() => {
    if (jobId) loadWaveform(jobId);
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId]);

  const loadWaveform = async (jid) => {
    try {
      const url = getAudioUrl(`/api/audio/editor/waveform/${jid}?num_points=2000`);
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.success) {
        setWaveform(data.waveform);
        setDuration(data.info.duration);
        setTotalSamples(data.total_samples);
        setAudioInfo(data.info);
        pushState({
          jobId: jid,
          waveform: data.waveform,
          duration: data.info.duration,
          totalSamples: data.total_samples,
        });
      }
    } catch (err) {
      Alert.alert("Error", "Failed to load waveform");
    }
  };

  const ensureUploaded = async () => {
    if (jobId) return jobId;
    if (!uri) {
      Alert.alert("No audio", "Record or upload audio first.");
      return null;
    }
    try {
      const result = await uploadAudio(uri, filename || "recording.wav");
      setJobId(result.job_id);
      return result.job_id;
    } catch (err) {
      Alert.alert("Upload failed", err.message);
      return null;
    }
  };

  const hasSelection = selStart !== null && selEnd !== null && Math.abs(selEnd - selStart) > 0.05;

  const handleToolPress = async (toolId) => {
    if (!hasSelection && ["cut", "trim", "silence", "fade_in", "fade_out"].includes(toolId)) {
      Alert.alert("Select region", "Drag on the waveform to select a region first.");
      return;
    }
    const currentJobId = await ensureUploaded();
    if (!currentJobId) return;
    if (toolId === "reverse") {
      await executeEdit("/api/audio/editor/reverse", {
        job_id: currentJobId,
        ...(hasSelection ? { start_time: selStart, end_time: selEnd } : {}),
      });
    } else if (toolId === "normalize") {
      await executeEdit("/api/audio/editor/normalize", {
        job_id: currentJobId,
        target_db: -18,
        ...(hasSelection ? { start_time: selStart, end_time: selEnd } : {}),
      });
    } else if (toolId === "fade_in") {
      await executeEdit("/api/audio/editor/fade", {
        job_id: currentJobId,
        fade_in_ms: 500,
        ...(hasSelection ? { start_time: selStart, end_time: selEnd } : {}),
      });
    } else if (toolId === "fade_out") {
      await executeEdit("/api/audio/editor/fade", {
        job_id: currentJobId,
        fade_out_ms: 500,
        ...(hasSelection ? { start_time: selStart, end_time: selEnd } : {}),
      });
    } else {
      const endpoint = toolId === "cut" ? "/api/audio/editor/cut" : "/api/audio/editor/trim";
      await executeEdit(endpoint, {
        job_id: currentJobId,
        start_time: Math.min(selStart, selEnd),
        end_time: Math.max(selStart, selEnd),
      });
    }
  };

  const executeEdit = async (endpoint, params) => {
    setProcessing(true);
    setActiveTool(endpoint);
    try {
      let result;
      const jid = params.job_id;
      const s = params.start_time;
      const e = params.end_time;
      if (endpoint.includes("/cut")) {
        result = await editorCut(jid, s, e);
      } else if (endpoint.includes("/trim")) {
        result = await editorTrim(jid, s, e);
      } else if (endpoint.includes("/reverse")) {
        result = await editorReverse(jid, params.start_time, params.end_time);
      } else if (endpoint.includes("/silence")) {
        result = await editorSilence(jid, s, e);
      } else if (endpoint.includes("/normalize")) {
        result = await editorNormalize(jid, params.target_db || -18, params.start_time, params.end_time);
      } else if (endpoint.includes("/fade")) {
        result = await editorFade(jid, params.fade_in_ms || 0, params.fade_out_ms || 0, params.start_time, params.end_time);
      }
      if (result && result.success) {
        setSelStart(null);
        setSelEnd(null);
        setJobId(result.job_id);
        setEditCount((c) => c + 1);
        await loadWaveform(result.job_id);
      } else {
        Alert.alert("Failed", result?.detail || "Edit failed");
      }
    } catch (err) {
      Alert.alert("Error", err.message || "Edit failed");
    } finally {
      setProcessing(false);
      setActiveTool(null);
    }
  };

  const handleEffectSelect = async (effectId) => {
    if (!hasSelection) {
      Alert.alert("Select region", "Drag on the waveform to select a region first.");
      setShowEffectsModal(false);
      return;
    }
    const currentJobId = await ensureUploaded();
    if (!currentJobId) return;
    setShowEffectsModal(false);
    setProcessing(true);
    try {
      const result = await editorEffectRegion(
        currentJobId,
        effectId,
        {},
        Math.min(selStart, selEnd),
        Math.max(selStart, selEnd)
      );
      if (result.success) {
        setSelStart(null);
        setSelEnd(null);
        setJobId(result.job_id);
        setEditCount((c) => c + 1);
        await loadWaveform(result.job_id);
      } else {
        Alert.alert("Failed", result.detail || "Effect failed");
      }
    } catch (err) {
      Alert.alert("Error", err.message || "Effect failed");
    } finally {
      setProcessing(false);
    }
  };

  const playSelection = async () => {
    if (isPlaying && soundRef.current) {
      try { await soundRef.current.pause(); } catch (_) {}
      setIsPlaying(false);
      if (playIntervalRef.current) { clearInterval(playIntervalRef.current); playIntervalRef.current = null; }
      return;
    }
    if (!isPlaying && soundRef.current) {
      try { await soundRef.current.play(); setIsPlaying(true); return; } catch (_) {}
    }
    const currentJobId = await ensureUploaded();
    if (!currentJobId) return;
    const tryUrls = [
      `/outputs/${currentJobId}_edited.wav`,
      `/outputs/${currentJobId}_final.wav`,
      `/outputs/${currentJobId}_autotuned.wav`,
      `/outputs/${currentJobId}_effects.wav`,
    ];
    let player = null;
    for (const urlPath of tryUrls) {
      try {
        const url = getAudioUrl(urlPath);
        player = await createAudioPlayer(url, (s) => {
          if (s.didJustFinish) {
            setIsPlaying(false);
            setPlayheadPos(null);
            soundRef.current = null;
            if (playIntervalRef.current) { clearInterval(playIntervalRef.current); playIntervalRef.current = null; }
          } else if (s.positionMillis) {
            setPlayheadPos(s.positionMillis / 1000);
          }
        });
        break;
      } catch (_) { player = null; }
    }
    if (!player) {
      try {
        const resp = await fetch(getAudioUrl(`/outputs/${currentJobId}_edited.wav`));
        if (resp.ok) {
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          player = await createAudioPlayer(blobUrl, (s) => {
            if (s.didJustFinish) {
              setIsPlaying(false);
              setPlayheadPos(null);
              soundRef.current = null;
            } else if (s.positionMillis) {
              setPlayheadPos(s.positionMillis / 1000);
            }
          });
        }
      } catch (_) {}
    }
    if (player) {
      soundRef.current = player;
      setIsPlaying(true);
    } else {
      Alert.alert("No audio", "No playable audio file found for this track.");
    }
  };

  const handleUndo = async () => {
    const prev = undo();
    if (prev) {
      setJobId(prev.jobId);
      setWaveform(prev.waveform);
      setDuration(prev.duration);
      setTotalSamples(prev.totalSamples);
      setSelStart(null);
      setSelEnd(null);
    }
  };

  const handleRedo = async () => {
    const next = redo();
    if (next) {
      setJobId(next.jobId);
      setWaveform(next.waveform);
      setDuration(next.duration);
      setTotalSamples(next.totalSamples);
      setSelStart(null);
      setSelEnd(null);
    }
  };

  const formatTime = (t) => {
    if (t === null || t === undefined) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.bgOrb1} />
      <View style={s.bgOrb2} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <MaterialIcons name="arrow-back" size={20} color="#6B7280" />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Studio</Text>
        <Text style={s.subtitle}>Professional audio editor</Text>
      </View>

      {audioInfo && (
        <View style={s.infoRow}>
          <View style={s.infoBadge}>
            <MaterialIcons name="timer" size={14} color="#06B6D4" />
            <Text style={s.infoText}>{formatTime(audioInfo.duration)}</Text>
          </View>
          <View style={s.infoBadge}>
            <MaterialIcons name="graphic-eq" size={14} color="#A855F7" />
            <Text style={s.infoText}>{audioInfo.sample_rate} Hz</Text>
          </View>
          <View style={s.infoBadge}>
            <MaterialIcons name="insights" size={14} color="#22C55E" />
            <Text style={s.infoText}>{audioInfo.format}</Text>
          </View>
        </View>
      )}

      {!jobId && !processing && (
        <TouchableOpacity style={s.uploadCard} onPress={pickFile} activeOpacity={0.7}>
          <View style={s.uploadIcon}>
            <MaterialIcons name="cloud-upload" size={36} color="#A855F7" />
          </View>
          <Text style={s.uploadTitle}>Upload Audio to Edit</Text>
          <Text style={s.uploadDesc}>Tap to pick any audio file — mp3, wav, m4a, aac, or even video</Text>
        </TouchableOpacity>
      )}

      {processing && !jobId && (
        <View style={s.uploadCard}>
          <ActivityIndicator size="large" color="#A855F7" />
          <Text style={[s.uploadTitle, { marginTop: 12 }]}>Uploading...</Text>
        </View>
      )}

      <WaveformEditor
        waveform={waveform}
        duration={duration}
        totalSamples={totalSamples}
        selectionStart={selStart}
        selectionEnd={selEnd}
        onSelectionChange={(start, end) => {
          setSelStart(start);
          setSelEnd(end);
        }}
        playheadPosition={playheadPos}
        style={s.waveform}
      />

      {hasSelection && (
        <View style={s.selectionInfo}>
          <Text style={s.selectionText}>
            Selected: {formatTime(Math.min(selStart, selEnd))} — {formatTime(Math.max(selStart, selEnd))}
            {" "}({(Math.abs(selEnd - selStart)).toFixed(1)}s)
          </Text>
          <TouchableOpacity onPress={() => { setSelStart(null); setSelEnd(null); }}>
            <MaterialIcons name="close" size={16} color="#F43F5E" />
          </TouchableOpacity>
        </View>
      )}

      <View style={s.playbackRow}>
        <TouchableOpacity style={s.playBtn} onPress={playSelection}>
          <MaterialIcons name={isPlaying ? "pause" : "play-arrow"} size={28} color="#fff" />
        </TouchableOpacity>
        <View style={s.timeDisplay}>
          <Text style={s.timeCurrent}>{formatTime(playheadPos || 0)}</Text>
          <Text style={s.timeDivider}>/</Text>
          <Text style={s.timeTotal}>{formatTime(duration)}</Text>
        </View>
      </View>

      <View style={s.toolbar}>
        <Text style={s.sectionLabel}>Edit Tools</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.toolsScroll}>
          {TOOLS.map((tool) => (
            <TouchableOpacity
              key={tool.id}
              style={[s.toolCard, activeTool === tool.id && s.toolCardActive]}
              onPress={() => handleToolPress(tool.id)}
              disabled={processing}
            >
              <View style={[s.toolIcon, { backgroundColor: tool.color + "20" }]}>
                <MaterialIcons name={tool.icon} size={22} color={tool.color} />
              </View>
              <Text style={[s.toolLabel, { color: tool.color }]}>{tool.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.toolbar}>
        <View style={s.effectsHeader}>
          <Text style={s.sectionLabel}>Region Effects</Text>
          <TouchableOpacity
            style={s.effectsBtn}
            onPress={() => {
              if (!hasSelection) {
                Alert.alert("Select region", "Drag on the waveform to select a region first.");
                return;
              }
              setShowEffectsModal(true);
            }}
          >
            <MaterialIcons name="add-circle-outline" size={18} color="#A855F7" />
            <Text style={s.effectsBtnText}>Apply to Selection</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.historyRow}>
        <TouchableOpacity
          style={[s.historyBtn, !canUndo && s.historyBtnDisabled]}
          onPress={handleUndo}
          disabled={!canUndo}
        >
          <MaterialIcons name="undo" size={18} color={canUndo ? "#A855F7" : "#4B5563"} />
          <Text style={[s.historyText, !canUndo && s.historyTextDisabled]}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.historyBtn, !canRedo && s.historyBtnDisabled]}
          onPress={handleRedo}
          disabled={!canRedo}
        >
          <MaterialIcons name="redo" size={18} color={canRedo ? "#06B6D4" : "#4B5563"} />
          <Text style={[s.historyText, !canRedo && s.historyTextDisabled]}>Redo</Text>
        </TouchableOpacity>
        <Text style={s.editCount}>{editCount} edits</Text>
      </View>

      <Modal visible={showEffectsModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Select Effect</Text>
              <TouchableOpacity onPress={() => setShowEffectsModal(false)}>
                <MaterialIcons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <Text style={s.modalHint}>
              Apply to: {formatTime(Math.min(selStart, selEnd))} — {formatTime(Math.max(selStart, selEnd))}
            </Text>
            <FlatList
              data={EFFECTS}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.effectItem}
                  onPress={() => handleEffectSelect(item.id)}
                >
                  <View style={[s.effectIcon, { backgroundColor: item.color + "20" }]}>
                    <MaterialIcons name={item.icon} size={22} color={item.color} />
                  </View>
                  <Text style={[s.effectLabel, { color: item.color }]}>{item.label}</Text>
                  <MaterialIcons name="chevron-right" size={20} color="#4B5563" />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {processing && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color="#A855F7" />
          <Text style={s.loadingText}>Processing...</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a12" },
  content: { padding: 20, paddingTop: 50, paddingBottom: 40 },
  bgOrb1: { position: "absolute", width: 250, height: 250, borderRadius: 125, backgroundColor: "rgba(168, 85, 247, 0.05)", top: -60, right: -80 },
  bgOrb2: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(6, 182, 212, 0.04)", bottom: 100, left: -60 },
  header: { marginBottom: 16 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  backText: { color: "#6B7280", fontSize: 14 },
  title: { color: "#fff", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "#6B7280", fontSize: 13, marginTop: 4 },
  infoRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  infoBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(168, 85, 247, 0.08)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.15)" },
  infoText: { color: "#9CA3AF", fontSize: 11, fontWeight: "600", fontFamily: "monospace" },
  waveform: { marginBottom: 8 },
  selectionInfo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(168, 85, 247, 0.1)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#A855F7", marginBottom: 12 },
  selectionText: { color: "#A855F7", fontSize: 12, fontWeight: "700", fontFamily: "monospace" },
  playbackRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 20 },
  playBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#7C3AED", justifyContent: "center", alignItems: "center", shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
  timeDisplay: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  timeCurrent: { color: "#A855F7", fontSize: 20, fontWeight: "800", fontFamily: "monospace" },
  timeDivider: { color: "#4B5563", fontSize: 16 },
  timeTotal: { color: "#6B7280", fontSize: 14, fontFamily: "monospace" },
  toolbar: { marginBottom: 16 },
  sectionLabel: { color: "#9CA3AF", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  toolsScroll: { flexDirection: "row" },
  toolCard: { alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: "rgba(168, 85, 247, 0.05)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)", marginRight: 8, minWidth: 72 },
  toolCardActive: { backgroundColor: "rgba(168, 85, 247, 0.15)", borderColor: "#A855F7" },
  toolIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: "center", alignItems: "center", marginBottom: 6 },
  toolLabel: { fontSize: 10, fontWeight: "700" },
  effectsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  effectsBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(168, 85, 247, 0.12)", borderWidth: 1, borderColor: "#A855F7" },
  effectsBtnText: { color: "#A855F7", fontSize: 12, fontWeight: "700" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, marginBottom: 20 },
  historyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(168, 85, 247, 0.08)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.15)" },
  historyBtnDisabled: { opacity: 0.4, borderColor: "rgba(168, 85, 247, 0.05)" },
  historyText: { color: "#A855F7", fontSize: 12, fontWeight: "700" },
  historyTextDisabled: { color: "#4B5563" },
  editCount: { color: "#6B7280", fontSize: 12, marginLeft: "auto" },
  uploadCard: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, borderRadius: 20, backgroundColor: "rgba(168, 85, 247, 0.05)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.15)", borderStyle: "dashed", marginBottom: 16 },
  uploadIcon: { width: 72, height: 72, borderRadius: 20, backgroundColor: "rgba(168, 85, 247, 0.1)", justifyContent: "center", alignItems: "center", marginBottom: 14 },
  uploadTitle: { color: "#E5E7EB", fontSize: 16, fontWeight: "800", marginBottom: 6 },
  uploadDesc: { color: "#6B7280", fontSize: 12, textAlign: "center", lineHeight: 18 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#0a0a12", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "60%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  modalHint: { color: "#A855F7", fontSize: 12, fontFamily: "monospace", marginBottom: 16 },
  effectItem: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "rgba(168, 85, 247, 0.08)" },
  effectIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center", marginRight: 14 },
  effectLabel: { flex: 1, fontSize: 15, fontWeight: "700" },
  loadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,10,18,0.85)", justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#A855F7", fontSize: 14, fontWeight: "700", marginTop: 12 },
});
