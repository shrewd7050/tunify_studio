import React, { useState, useEffect } from "react";
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
  { label: "Pentatonic", value: "pentatonic_major" },
  { label: "Blues", value: "blues" },
];

export default function ProcessScreen({ route, navigation }) {
  const { uri, duration } = route.params;
  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedScale, setSelectedScale] = useState("major");
  const [correctionStrength, setCorrectionStrength] = useState(0.8);
  const [analyzing, setAnalyzing] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [jobId, setJobId] = useState(null);

  const STEPS = [
    "Uploading your recording...",
    "Analyzing key & tempo...",
    "Auto-tuning your voice...",
    "Generating AI backing track...",
    "Mixing everything together...",
  ];

  useEffect(() => {
    analyzeRecording();
  }, []);

  const analyzeRecording = async () => {
    try {
      setAnalyzing(true);
      const uploadResult = await uploadAudio(uri, "recording.wav");
      setJobId(uploadResult.job_id);

      const analysis = await analyzeAudio(uploadResult.filename);
      setSelectedKey(analysis.key);
      setSelectedScale(analysis.scale);
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleProcess = async () => {
    if (!jobId) {
      Alert.alert("Error", "Please wait for analysis to complete.");
      return;
    }

    setProcessing(true);
    setCurrentStep(0);

    try {
      for (let i = 0; i <= 4; i++) {
        setCurrentStep(i);
        await new Promise((r) => setTimeout(r, 1500));
      }

      const result = await processFull(jobId, {
        key: selectedKey,
        scale: selectedScale,
        correction_strength: correctionStrength,
      });

      navigation.navigate("Results", {
        jobId: result.job_id,
        key: result.key,
        scale: result.scale,
        duration: result.duration,
        autotunedUrl: result.autotuned_url,
        backingUrl: result.backing_url,
        finalUrl: result.final_url,
      });
    } catch (err) {
      Alert.alert("Processing Failed", err.message || "Something went wrong");
      setProcessing(false);
    }
  };

  if (processing) {
    return (
      <View style={styles.processingContainer}>
        <ActivityIndicator size="large" color="#00FF88" />
        <Text style={styles.processingTitle}>Processing your audio</Text>
        <Text style={styles.processingSubtitle}>
          This may take a minute...
        </Text>

        <View style={styles.processingSteps}>
          {STEPS.map((step, i) => (
            <View
              key={i}
              style={[
                styles.stepRow,
                i === currentStep && styles.stepRowActive,
                i < currentStep && styles.stepRowDone,
              ]}
            >
              <View style={styles.stepIcon}>
                {i < currentStep ? (
                  <MaterialIcons name="check" size={16} color="#00FF88" />
                ) : i === currentStep ? (
                  <ActivityIndicator size="small" color="#00FF88" />
                ) : (
                  <Text style={{ color: "#444", fontSize: 12 }}>{i + 1}</Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepText,
                  i === currentStep && styles.stepTextActive,
                  i < currentStep && styles.stepTextDone,
                ]}
              >
                {step}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 24 }}
      >
        <MaterialIcons name="arrow-back" size={20} color="#888" />
        <Text style={{ color: "#888", fontSize: 14 }}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.resultsTitle}>Tune Settings</Text>
      <Text style={styles.resultsSubtitle}>
        Adjust before processing. Key is auto-detected.
      </Text>

      {/* Key Selection */}
      <Text style={[styles.settingsLabel, { marginTop: 30, marginBottom: 12 }]}>
        Key
      </Text>
      {analyzing ? (
        <ActivityIndicator size="small" color="#00FF88" style={{ marginBottom: 20 }} />
      ) : (
        <View style={localStyles.keyGrid}>
          {KEYS.map((k) => (
            <TouchableOpacity
              key={k}
              style={[
                localStyles.keyButton,
                selectedKey === k && localStyles.keyButtonActive,
              ]}
              onPress={() => setSelectedKey(k)}
            >
              <Text
                style={[
                  localStyles.keyButtonText,
                  selectedKey === k && localStyles.keyButtonTextActive,
                ]}
              >
                {k}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Scale Selection */}
      <Text style={[styles.settingsLabel, { marginTop: 24, marginBottom: 12 }]}>
        Scale
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {SCALES.map((s) => (
          <TouchableOpacity
            key={s.value}
            style={[
              localStyles.scaleButton,
              selectedScale === s.value && localStyles.scaleButtonActive,
            ]}
            onPress={() => setSelectedScale(s.value)}
          >
            <Text
              style={[
                localStyles.scaleButtonText,
                selectedScale === s.value && localStyles.scaleButtonTextActive,
              ]}
            >
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Correction Strength */}
      <Text style={[styles.settingsLabel, { marginTop: 24, marginBottom: 12 }]}>
        Correction Strength: {Math.round(correctionStrength * 100)}%
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ color: "#666", fontSize: 12 }}>Natural</Text>
        <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
          {[0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
            <TouchableOpacity
              key={v}
              style={[
                localStyles.strengthBar,
                correctionStrength >= v && localStyles.strengthBarActive,
              ]}
              onPress={() => setCorrectionStrength(v)}
            />
          ))}
        </View>
        <Text style={{ color: "#666", fontSize: 12 }}>Hard</Text>
      </View>

      {/* Process Button */}
      <TouchableOpacity
        style={[localStyles.processButton, { marginTop: 40 }]}
        onPress={handleProcess}
        disabled={!jobId}
        activeOpacity={0.8}
      >
        <MaterialIcons name="auto-fix-high" size={22} color="#0a0a0a" />
        <Text style={localStyles.processButtonText}>Process Audio</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const localStyles = StyleSheet.create({
  keyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  keyButton: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#111",
    justifyContent: "center",
    alignItems: "center",
  },
  keyButtonActive: {
    backgroundColor: "#00FF88",
  },
  keyButtonText: {
    color: "#888",
    fontSize: 16,
    fontWeight: "700",
  },
  keyButtonTextActive: {
    color: "#0a0a0a",
  },
  scaleButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#111",
  },
  scaleButtonActive: {
    backgroundColor: "#00FF88",
  },
  scaleButtonText: {
    color: "#888",
    fontSize: 13,
    fontWeight: "700",
  },
  scaleButtonTextActive: {
    color: "#0a0a0a",
  },
  strengthBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#222",
  },
  strengthBarActive: {
    backgroundColor: "#00FF88",
  },
  processButton: {
    backgroundColor: "#00FF88",
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  processButtonText: {
    color: "#0a0a0a",
    fontSize: 17,
    fontWeight: "800",
  },
});
