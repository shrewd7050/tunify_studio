import React, { useState } from "react";
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
import { Audio } from "expo-av";
import { MaterialIcons } from "@expo/vector-icons";
import { generateMusic, downloadFile } from "../services/api";
import styles from "../styles/theme";

const PRESETS = [
  { label: "Pop Beat", prompt: "upbeat pop instrumental, catchy melody, 120 bpm" },
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

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      Alert.alert("Enter a prompt", "Describe the music you want to generate.");
      return;
    }

    setGenerating(true);
    try {
      const result = await generateMusic(prompt.trim(), selectedDuration);
      setGeneratedUrl(result.download_url);
    } catch (err) {
      Alert.alert("Generation Failed", err.message || "Try again");
    } finally {
      setGenerating(false);
    }
  };

  const playGenerated = async () => {
    try {
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
        setIsPlaying(false);
        return;
      }

      const localUri = await downloadFile(generatedUrl);
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: localUri },
        { shouldPlay: true },
        (status) => {
          if (status.didJustFinish) {
            setIsPlaying(false);
            setSound(null);
          }
        }
      );
      setSound(newSound);
      setIsPlaying(true);
    } catch (err) {
      Alert.alert("Playback Error", err.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingTop: 60, paddingBottom: 40 }}
      >
        <Text style={styles.logo}>TUNIFY</Text>
        <Text style={styles.tagline}>AI MUSIC GENERATOR</Text>

        {/* Prompt Input */}
        <Text style={[styles.settingsLabel, { marginTop: 30 }]}>
          Describe your music
        </Text>
        <TextInput
          style={localStyles.textInput}
          placeholder="e.g., upbeat pop beat with piano, 120 bpm"
          placeholderTextColor="#444"
          value={prompt}
          onChangeText={setPrompt}
          multiline
          numberOfLines={3}
        />

        {/* Presets */}
        <Text style={[styles.settingsLabel, { marginTop: 20 }]}>Quick Presets</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {PRESETS.map((p) => (
            <TouchableOpacity
              key={p.label}
              style={[
                localStyles.presetButton,
                prompt === p.prompt && localStyles.presetButtonActive,
              ]}
              onPress={() => setPrompt(p.prompt)}
            >
              <Text
                style={[
                  localStyles.presetText,
                  prompt === p.prompt && localStyles.presetTextActive,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Duration */}
        <Text style={[styles.settingsLabel, { marginTop: 20 }]}>
          Duration: {selectedDuration}s
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
          {DURATIONS.map((d) => (
            <TouchableOpacity
              key={d}
              style={[
                localStyles.durationButton,
                selectedDuration === d && localStyles.durationButtonActive,
              ]}
              onPress={() => setSelectedDuration(d)}
            >
              <Text
                style={[
                  localStyles.durationText,
                  selectedDuration === d && localStyles.durationTextActive,
                ]}
              >
                {d}s
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Generate Button */}
        <TouchableOpacity
          style={[localStyles.generateButton, { marginTop: 30 }]}
          onPress={handleGenerate}
          disabled={generating}
          activeOpacity={0.8}
        >
          {generating ? (
            <ActivityIndicator size="small" color="#0a0a0a" />
          ) : (
            <>
              <MaterialIcons name="auto-awesome" size={20} color="#0a0a0a" />
              <Text style={localStyles.generateButtonText}>Generate Music</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Generated Result */}
        {generatedUrl && (
          <View style={localStyles.resultCard}>
            <Text style={styles.playerTitle}>Generated Music</Text>
            <Text style={styles.playerSubtitle}>{selectedDuration}s | AI Generated</Text>
            <TouchableOpacity
              style={[styles.playButton, { marginTop: 16 }]}
              onPress={playGenerated}
            >
              <MaterialIcons
                name={isPlaying ? "pause" : "play-arrow"}
                size={28}
                color="#0a0a0a"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.downloadButton, { marginTop: 12 }]}
              onPress={() => Alert.alert("Downloaded")}
            >
              <Text style={styles.downloadButtonText}>Download</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  textInput: {
    backgroundColor: "#111",
    borderRadius: 14,
    padding: 16,
    color: "#fff",
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: "top",
    marginTop: 8,
  },
  presetButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#1a1a2e",
  },
  presetButtonActive: {
    backgroundColor: "#00FF88",
  },
  presetText: {
    color: "#888",
    fontSize: 12,
    fontWeight: "700",
  },
  presetTextActive: {
    color: "#0a0a0a",
  },
  durationButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#111",
  },
  durationButtonActive: {
    backgroundColor: "#00FF88",
  },
  durationText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "700",
  },
  durationTextActive: {
    color: "#0a0a0a",
  },
  generateButton: {
    backgroundColor: "#00FF88",
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  generateButtonText: {
    color: "#0a0a0a",
    fontSize: 17,
    fontWeight: "800",
  },
  resultCard: {
    backgroundColor: "#111",
    borderRadius: 20,
    padding: 24,
    marginTop: 20,
    alignItems: "center",
  },
});
