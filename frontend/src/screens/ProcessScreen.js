import React, { useState, useEffect, useRef } from "react";
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
import { uploadAudio, analyzeAudio, processFull } from "../services/api";
import styles from "../styles/theme";

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES = [
  { label: "Major", value: "major" },
  { label: "Minor", value: "minor" },
  { label: "Penta", value: "pentatonic_major" },
  { label: "Blues", value: "blues" },
];

export default function ProcessScreen({ route, navigation }) {
  const { uri, duration, lyrics, jobId: initialJobId, fromUpload, recordingBlob } = route.params;
  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedScale, setSelectedScale] = useState("major");
  const [correctionStrength, setCorrectionStrength] = useState(0.8);
  const [analyzing, setAnalyzing] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [jobId, setJobId] = useState(initialJobId || null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  const STEPS = [
    "Uploading your recording...",
    "Analyzing key & tempo...",
    "Auto-tuning your voice...",
    "Generating AI backing track...",
    "Mixing everything together...",
  ];

  useEffect(() => { analyzeRecording(); }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  };

  const analyzeRecording = async () => {
    try {
      setAnalyzing(true);
      let filename;
      if (fromUpload && initialJobId) {
        filename = initialJobId;
      } else {
        const upload = await uploadAudio(uri, "recording.wav", recordingBlob);
        setJobId(upload.job_id);
        filename = upload.filename;
      }
      const analysis = await analyzeAudio(filename);
      setSelectedKey(analysis.key);
      setSelectedScale(analysis.scale);
    } catch (err) {
      console.error("Analysis failed:", err);
      Alert.alert("Analysis Failed", "Could not analyze audio. You can still proceed with default settings.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleProcess = async () => {
    if (!jobId) { Alert.alert("Error", "Wait for analysis to finish."); return; }
    setProcessing(true);
    setElapsed(0);
    setCurrentStep(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      setCurrentStep(1);
      const result = await processFull(jobId, { key: selectedKey, scale: selectedScale, correction_strength: correctionStrength });
      setCurrentStep(5);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      navigation.navigate("Results", {
        jobId: result.job_id, key: result.key, scale: result.scale,
        duration: result.duration, processingTime: result.processing_time,
        autotunedUrl: result.autotuned_url,
        backingUrl: result.backing_url || null,
        finalUrl: result.final_url || null,
      });
    } catch (err) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const msg = err?.response?.data?.detail || err?.message || "Something went wrong";
      Alert.alert("Failed", msg);
      setProcessing(false);
    }
  };

  if (processing) {
    return (
      <View style={styles.processingContainer}>
        <View style={localStyles.bgOrb1} />
        <View style={localStyles.bgOrb2} />
        <ActivityIndicator size="large" color="#A855F7" />
        <Text style={styles.processingTitle}>Processing your audio</Text>
        <Text style={{ color: "#A855F7", fontSize: 24, fontWeight: "800", marginTop: 12, fontVariant: ["tabular-nums"] }}>
          {formatTime(elapsed)}
        </Text>
        <Text style={styles.processingSubtitle}>This may take a minute...</Text>
        <View style={styles.processingSteps}>
          {STEPS.map((step, i) => {
            const isActive = i === currentStep;
            const isDone = i < currentStep;
            return (
              <View key={i} style={[styles.stepRow, isActive && styles.stepRowActive, isDone && styles.stepRowDone]}>
                <View style={styles.stepIcon}>
                  {isDone ? <MaterialIcons name="check" size={16} color="#22C55E" /> : isActive ? <ActivityIndicator size="small" color="#A855F7" /> : <Text style={{ color: "#4B5563", fontSize: 12 }}>{i + 1}</Text>}
                </View>
                <Text style={[styles.stepText, isActive && styles.stepTextActive, isDone && styles.stepTextDone]}>{step}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 40, backgroundColor: "#0a0a12" }}>
      <View style={localStyles.bgOrb1} />
      <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 24 }}>
        <MaterialIcons name="arrow-back" size={20} color="#6B7280" />
        <Text style={{ color: "#6B7280", fontSize: 14 }}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.resultsTitle}>Tune Settings</Text>
      <Text style={styles.resultsSubtitle}>Adjust before processing. Key is auto-detected.</Text>

      {/* Key */}
      <Text style={[styles.settingsLabel, { marginTop: 28, marginBottom: 12 }]}>Key</Text>
      {analyzing ? <ActivityIndicator size="small" color="#A855F7" /> : (
        <View style={localStyles.keyGrid}>
          {KEYS.map((k) => (
            <TouchableOpacity key={k} style={[localStyles.keyBtn, selectedKey === k && localStyles.keyBtnActive]} onPress={() => setSelectedKey(k)}>
              <Text style={[localStyles.keyBtnText, selectedKey === k && localStyles.keyBtnTextActive]}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Scale */}
      <Text style={[styles.settingsLabel, { marginTop: 22, marginBottom: 12 }]}>Scale</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {SCALES.map((s) => (
          <TouchableOpacity key={s.value} style={[localStyles.scaleBtn, selectedScale === s.value && localStyles.scaleBtnActive]} onPress={() => setSelectedScale(s.value)}>
            <Text style={[localStyles.scaleBtnText, selectedScale === s.value && localStyles.scaleBtnTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Strength */}
      <Text style={[styles.settingsLabel, { marginTop: 22, marginBottom: 12 }]}>
        Correction: {Math.round(correctionStrength * 100)}%
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ color: "#4B5563", fontSize: 12 }}>Soft</Text>
        <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
          {[0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
            <TouchableOpacity key={v} style={[localStyles.strengthBar, correctionStrength >= v && localStyles.strengthBarActive]} onPress={() => setCorrectionStrength(v)} />
          ))}
        </View>
        <Text style={{ color: "#4B5563", fontSize: 12 }}>Hard</Text>
      </View>

      {!jobId && !analyzing && (
        <Text style={{ color: "#F43F5E", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 12 }}>
          Could not load audio. Go back and try again.
        </Text>
      )}

      <TouchableOpacity
        style={[localStyles.processBtn, { marginTop: 36 }, (!jobId || analyzing) && localStyles.processBtnDisabled]}
        onPress={handleProcess}
        disabled={!jobId || analyzing}
        activeOpacity={0.8}
      >
        {analyzing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <MaterialIcons name="auto-fix-high" size={22} color="#fff" />
            <Text style={localStyles.processBtnText}>Process Audio</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const localStyles = StyleSheet.create({
  bgOrb1: { position: "absolute", width: 250, height: 250, borderRadius: 125, backgroundColor: "rgba(168, 85, 247, 0.05)", top: -60, right: -80 },
  bgOrb2: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(6, 182, 212, 0.04)", bottom: 100, left: -60 },
  keyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  keyBtn: { width: 52, height: 52, borderRadius: 14, backgroundColor: "rgba(168, 85, 247, 0.08)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.15)", justifyContent: "center", alignItems: "center" },
  keyBtnActive: { backgroundColor: "#7C3AED", borderColor: "#A855F7" },
  keyBtnText: { color: "#6B7280", fontSize: 16, fontWeight: "700" },
  keyBtnTextActive: { color: "#fff" },
  scaleBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(168, 85, 247, 0.08)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)" },
  scaleBtnActive: { backgroundColor: "#7C3AED", borderColor: "#A855F7" },
  scaleBtnText: { color: "#6B7280", fontSize: 13, fontWeight: "700" },
  scaleBtnTextActive: { color: "#fff" },
  strengthBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "rgba(168, 85, 247, 0.1)" },
  strengthBarActive: { backgroundColor: "#A855F7" },
  processBtn: { backgroundColor: "#7C3AED", borderRadius: 16, paddingVertical: 18, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
  processBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },
  processBtnText: { color: "#fff", fontSize: 17, fontWeight: "800" },
});
