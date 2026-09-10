import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { generateMusic, downloadFile, getAudioUrl, createAudioPlayer } from "../services/api";

const PRESETS = [
  { label: "Pop", prompt: "upbeat pop instrumental, catchy melody, 120 bpm" },
  { label: "Lo-Fi", prompt: "lo-fi hip hop, chill beats, mellow, study music" },
  { label: "EDM", prompt: "electronic dance music, heavy bass, energetic, 128 bpm" },
  { label: "Acoustic", prompt: "acoustic guitar, folk, gentle, warm" },
  { label: "Trap", prompt: "trap beat, 808s, hi-hats, dark, 140 bpm" },
  { label: "Jazz", prompt: "jazz instrumental, saxophone, piano, smooth" },
];

const DURATIONS = [5, 10, 15, 20, 30];

export default function GenerateScreen({ navigation }) {
  const [prompt, setPrompt] = useState("");
  const [selectedDuration, setSelectedDuration] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sound, setSound] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [processingTime, setProcessingTime] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const timerRef = useRef(null);
  const soundRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (soundRef.current) { soundRef.current.unload().catch(() => {}); }
    };
  }, []);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  };

  const hasPrompt = prompt.trim().length > 0;

  const handleGenerate = async () => {
    if (!hasPrompt) {
      Alert.alert("Enter a prompt", "Type a description or pick a preset above.");
      return;
    }
    setGenerating(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const result = await generateMusic(prompt.trim(), selectedDuration);
      setGeneratedUrl(result.download_url);
      setProcessingTime(result.processing_time);
    } catch (err) { Alert.alert("Failed", err.message || "Try again"); }
    finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setGenerating(false);
    }
  };

  const playGenerated = async () => {
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

      setDownloading(true);
      const audioUri = getAudioUrl(generatedUrl);
      const player = await createAudioPlayer(audioUri, (st) => {
        if (st.didJustFinish) {
          setIsPlaying(false);
          soundRef.current = null;
        }
      });
      soundRef.current = player;
      setIsPlaying(true);
    } catch (err) {
      Alert.alert("Playback Error", err.message || "Could not play audio");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#0a0a12" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 40 }}>
        <View style={localStyles.bgOrb1} />
        <View style={localStyles.bgOrb2} />

        <TouchableOpacity onPress={() => navigation.navigate("Record")} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
          <MaterialIcons name="arrow-back" size={20} color="#6B7280" />
          <Text style={{ color: "#6B7280", fontSize: 14 }}>Back</Text>
        </TouchableOpacity>

        <Text style={{ fontSize: 38, fontWeight: "900", color: "#A855F7", textAlign: "center", letterSpacing: 3, textShadowColor: "rgba(168, 85, 247, 0.4)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 15 }}>
          TUNIFY
        </Text>
        <Text style={{ color: "#7C3AED", fontSize: 12, textAlign: "center", letterSpacing: 3, marginTop: 4, fontWeight: "600" }}>
          AI MUSIC GENERATOR
        </Text>

        {/* Prompt */}
        <Text style={{ color: "#9CA3AF", fontSize: 14, fontWeight: "600", marginTop: 28 }}>Describe your music</Text>
        <TextInput
          style={[localStyles.textInput, !hasPrompt && generatedUrl === null && localStyles.textInputEmpty]}
          placeholder="e.g., upbeat pop beat with piano, 120 bpm"
          placeholderTextColor="#4B5563"
          value={prompt}
          onChangeText={setPrompt}
          multiline
          numberOfLines={3}
        />

        {/* Presets */}
        <Text style={{ color: "#9CA3AF", fontSize: 14, fontWeight: "600", marginTop: 20 }}>Quick Presets</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {PRESETS.map((p) => (
            <TouchableOpacity key={p.label} style={[localStyles.presetBtn, prompt === p.prompt && localStyles.presetBtnActive]} onPress={() => setPrompt(p.prompt)}>
              <Text style={[localStyles.presetText, prompt === p.prompt && localStyles.presetTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Duration */}
        <Text style={{ color: "#9CA3AF", fontSize: 14, fontWeight: "600", marginTop: 20 }}>Duration: {selectedDuration}s</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
          {DURATIONS.map((d) => (
            <TouchableOpacity key={d} style={[localStyles.durBtn, selectedDuration === d && localStyles.durBtnActive]} onPress={() => setSelectedDuration(d)}>
              <Text style={[localStyles.durText, selectedDuration === d && localStyles.durTextActive]}>{d}s</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Generate Button */}
        <TouchableOpacity
          style={[localStyles.genBtn, { marginTop: 30 }, !hasPrompt && localStyles.genBtnEmpty]}
          onPress={handleGenerate}
          disabled={generating}
          activeOpacity={0.8}
        >
          {generating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <MaterialIcons name={hasPrompt ? "auto-awesome" : "warning"} size={20} color="#fff" />
              <Text style={localStyles.genBtnText}>{hasPrompt ? "Generate Music" : "Type or select a prompt"}</Text>
            </>
          )}
        </TouchableOpacity>

        {generating && (
          <View style={{ alignItems: "center", marginTop: 20 }}>
            <Text style={{ color: "#A855F7", fontSize: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
              {formatTime(elapsed)}
            </Text>
            <Text style={{ color: "#6B7280", fontSize: 13, marginTop: 6 }}>
              Generating {selectedDuration}s of audio on GPU...
            </Text>
            <Text style={{ color: "#4B5563", fontSize: 11, marginTop: 4 }}>
              Usually takes ~{Math.ceil(selectedDuration * 3)}-{Math.ceil(selectedDuration * 8)}s
            </Text>
          </View>
        )}

        {/* Result */}
        {generatedUrl && (
          <View style={localStyles.resultCard}>
            <MaterialIcons name="check-circle" size={32} color="#22C55E" />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 8 }}>Generated Music</Text>
            <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 2 }}>{selectedDuration}s | AI Generated{processingTime ? ` | Generated in ${processingTime}s` : ""}</Text>
            <TouchableOpacity style={[localStyles.playBtn, { marginTop: 16 }]} onPress={playGenerated} disabled={downloading}>
              {downloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialIcons name={isPlaying ? "pause" : "play-arrow"} size={28} color="#fff" />
              )}
            </TouchableOpacity>
            {isPlaying && <Text style={{ color: "#A855F7", fontSize: 12, marginTop: 6 }}>Playing...</Text>}
            <TouchableOpacity
              style={{ marginTop: 12, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 12, backgroundColor: "rgba(6, 182, 212, 0.15)", borderWidth: 1, borderColor: "#06B6D4" }}
              onPress={async () => {
                try {
                  const localUri = await downloadFile(generatedUrl);
                  const msg = localUri.startsWith("http")
                    ? `Open in browser: ${localUri}`
                    : `Saved to: ${localUri}`;
                  Alert.alert("Downloaded", msg);
                } catch (err) {
                  Alert.alert("Download Failed", err.message || "Try again");
                }
              }}
            >
              <Text style={{ color: "#06B6D4", fontSize: 14, fontWeight: "700", textAlign: "center" }}>Download</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  bgOrb1: { position: "absolute", width: 250, height: 250, borderRadius: 125, backgroundColor: "rgba(168, 85, 247, 0.05)", top: -40, right: -70 },
  bgOrb2: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(6, 182, 212, 0.04)", bottom: 150, left: -50 },
  textInput: { backgroundColor: "rgba(168, 85, 247, 0.06)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)", borderRadius: 14, padding: 16, color: "#fff", fontSize: 15, minHeight: 80, textAlignVertical: "top", marginTop: 8 },
  textInputEmpty: { borderColor: "rgba(244, 63, 94, 0.3)", backgroundColor: "rgba(244, 63, 94, 0.04)" },
  presetBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(168, 85, 247, 0.08)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)" },
  presetBtnActive: { backgroundColor: "#7C3AED", borderColor: "#A855F7" },
  presetText: { color: "#6B7280", fontSize: 12, fontWeight: "700" },
  presetTextActive: { color: "#fff" },
  durBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: "rgba(168, 85, 247, 0.08)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.12)" },
  durBtnActive: { backgroundColor: "#7C3AED", borderColor: "#A855F7" },
  durText: { color: "#6B7280", fontSize: 14, fontWeight: "700" },
  durTextActive: { color: "#fff" },
  genBtn: { backgroundColor: "#7C3AED", borderRadius: 16, paddingVertical: 18, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
  genBtnEmpty: { backgroundColor: "rgba(244, 63, 94, 0.25)", shadowColor: "#F43F5E", shadowOpacity: 0.3, borderWidth: 1, borderColor: "rgba(244, 63, 94, 0.4)" },
  genBtnText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  resultCard: { backgroundColor: "rgba(168, 85, 247, 0.08)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.15)", borderRadius: 22, padding: 24, marginTop: 20, alignItems: "center" },
  playBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#A855F7", justifyContent: "center", alignItems: "center", shadowColor: "#A855F7", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 15 },
});
