import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Animated,
  Dimensions,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Audio } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialIcons } from "@expo/vector-icons";
import { uploadAudio, createAudioPlayer } from "../services/api";

const FILES_KEY = "@tunify_files";

let Haptics = null;
if (Platform.OS !== "web") {
  try { Haptics = require("expo-haptics"); } catch (e) {}
}

const { width: SCREEN_W } = Dimensions.get("window");
const NOTES_WIDTH = Math.min(SCREEN_W * 0.45, 400);

export default function RecordScreen({ navigation }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState(null);
  const [lyrics, setLyrics] = useState("");
  const [notesTab, setNotesTab] = useState("Lyrics");
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [savedFiles, setSavedFiles] = useState([]);

  const chevronRotate = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const chevronPulse = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const recordingRef = useRef(null);
  const recordingBlobRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { loadFiles(); }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(chevronPulse, { toValue: 1.2, duration: 1200, useNativeDriver: true }),
        Animated.timing(chevronPulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  const loadFiles = async () => {
    try {
      const json = await AsyncStorage.getItem(FILES_KEY);
      setSavedFiles(json ? JSON.parse(json) : []);
    } catch (e) {}
  };

  const saveFileToList = async (file) => {
    const updated = [file, ...savedFiles];
    setSavedFiles(updated);
    await AsyncStorage.setItem(FILES_KEY, JSON.stringify(updated));
  };

  const removeFile = async (id) => {
    const updated = savedFiles.filter((f) => f.id !== id);
    setSavedFiles(updated);
    await AsyncStorage.setItem(FILES_KEY, JSON.stringify(updated));
  };

  const toggleNotes = () => {
    const next = !isNotesOpen;
    setIsNotesOpen(next);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: next ? 1 : 0, tension: 65, friction: 11, useNativeDriver: true }),
      Animated.timing(chevronRotate, { toValue: next ? 1 : 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { alert("Microphone permission required."); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
      setDuration(0);
      setHasRecording(false);
      setUploadedFile(null);
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Heavy);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) { alert("Recording failed: " + err.message); }
  };

  const stopRecording = async () => {
    try {
      if (!recordingRef.current) return;
      clearInterval(timerRef.current);
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (Platform.OS === "web" && uri) {
        try {
          const resp = await fetch(uri);
          recordingBlobRef.current = await resp.blob();
        } catch (e) {
          recordingBlobRef.current = null;
        }
      }

      setRecordingUri(uri);
      setIsRecording(false);
      setHasRecording(true);

      const fileEntry = {
        id: Date.now().toString(),
        name: `Recording ${savedFiles.length + 1}`,
        uri,
        type: "recording",
        date: new Date().toISOString(),
        duration,
      };
      await saveFileToList(fileEntry);
      Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType.Success);
    } catch (err) { console.error(err); }
  };

  const handleRecord = () => { isRecording ? stopRecording() : startRecording(); };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const file = result.assets[0];
      setIsUploading(true);

      const uploadResult = await uploadAudio(file.uri, file.name);
      setUploadedFile({ name: file.name, jobId: uploadResult.job_id });
      setHasRecording(true);
      setRecordingUri(file.uri);

      const fileEntry = {
        id: Date.now().toString(),
        name: file.name,
        uri: file.uri,
        type: "upload",
        jobId: uploadResult.job_id,
        date: new Date().toISOString(),
      };
      await saveFileToList(fileEntry);
    } catch (err) {
      alert("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setIsUploading(false);
    }
  };

  const goToProcess = () => {
    if (!recordingUri) return;
    navigation.navigate("Process", { uri: recordingUri, duration, lyrics, recordingBlob: recordingBlobRef.current });
  };

  const goToProcessUploaded = () => {
    if (!uploadedFile) return;
    navigation.navigate("Process", { uri: recordingUri, duration: 0, lyrics, jobId: uploadedFile.job_id, fromUpload: true });
  };

  const goToAutoTune = () => {
    if (!recordingUri) {
      Alert.alert("No audio", "Record or upload a file first.");
      return;
    }
    if (uploadedFile) {
      navigation.navigate("Process", { uri: recordingUri, duration: 0, lyrics, jobId: uploadedFile.job_id, fromUpload: true });
    } else {
      navigation.navigate("Process", { uri: recordingUri, duration, lyrics, recordingBlob: recordingBlobRef.current });
    }
  };

  const goToGenerate = () => {
    navigation.navigate("Generate");
  };

  const goToEffects = async () => {
    if (!recordingUri && !uploadedFile) {
      Alert.alert("No audio", "Record or upload a file first.");
      return;
    }
    let jid = uploadedFile?.jobId;
    if (!jid && recordingUri) {
      setIsUploading(true);
      try {
        const uploadResult = await uploadAudio(recordingUri, "recording.wav", recordingBlobRef.current);
        jid = uploadResult.job_id;
        const fileEntry = {
          id: Date.now().toString(),
          name: "Recording for effects",
          uri: recordingUri,
          type: "upload",
          jobId: jid,
          date: new Date().toISOString(),
        };
        await saveFileToList(fileEntry);
      } catch (err) {
        Alert.alert("Upload failed", "Could not upload recording for effects.");
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    }
    navigation.navigate("Effects", { uri: recordingUri, jobId: jid });
  };

  const playFile = async (file) => {
    try {
      const player = await createAudioPlayer(file.uri);
      await player.play();
    } catch (err) {
      Alert.alert("Error", "Cannot play this file.");
    }
  };

  const formatTime = (sec) => `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;

  const formatDate = (iso) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.scrollContent}>
      <View style={s.bgOrb1} />
      <View style={s.bgOrb2} />
      <View style={s.bgOrb3} />

      {/* NOTES DRAWER — slides in from left */}
      <Animated.View
        style={[
          s.notesPanel,
          {
            transform: [{
              translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [-NOTES_WIDTH, 0] }),
            }],
          },
        ]}
        pointerEvents={isNotesOpen ? "auto" : "none"}
      >
        <View style={s.notesHeader}>
          <View style={s.notesHeaderLeft}>
            <MaterialIcons name="edit-note" size={20} color="#A855F7" />
            <Text style={s.notesTitle}>Song Notes</Text>
          </View>
          <TouchableOpacity onPress={toggleNotes} style={s.notesCloseBtn}>
            <MaterialIcons name="close" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <View style={s.notesToolbar}>
          {["Lyrics", "Chords", "Ideas", "Tempo"].map((tab) => (
            <TouchableOpacity key={tab} style={[s.tabBtn, notesTab === tab && s.tabBtnActive]} onPress={() => setNotesTab(tab)}>
              <Text style={[s.tabText, notesTab === tab && s.tabTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={s.notesInput}
          placeholder={"Write your lyrics, chords, or ideas here...\n\nVerse 1:\nWalking down the street tonight...\n\nChorus:\nWe're dancing in the moonlight..."}
          placeholderTextColor="#4B5563"
          value={lyrics}
          onChangeText={setLyrics}
          multiline
          textAlignVertical="top"
        />

        <View style={s.notesFooter}>
          <Text style={s.charCount}>{lyrics.length} characters</Text>
          <TouchableOpacity onPress={() => setLyrics("")}>
            <Text style={s.clearBtn}>Clear</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* CHEVRON */}
      <TouchableOpacity style={s.chevronSlider} onPress={toggleNotes} activeOpacity={0.7}>
        <Animated.View style={{ transform: [
          { rotate: chevronRotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) },
          { scale: chevronPulse },
        ] }}>
          <MaterialIcons name="chevron-right" size={20} color="#A855F7" />
        </Animated.View>
      </TouchableOpacity>

      {/* BACKDROP */}
      <Animated.View
        style={[s.backdrop, { opacity: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }) }]}
        pointerEvents={isNotesOpen ? "auto" : "none"}
      >
        <TouchableOpacity style={{ flex: 1 }} onPress={toggleNotes} activeOpacity={1} />
      </Animated.View>

      {/* LOGO */}
      <View style={s.logoSection}>
        <Text style={s.logo}>TUNIFY</Text>
        <Text style={s.tagline}>AI MUSIC STUDIO</Text>
      </View>

      {/* RECORD BUTTON */}
      <View style={s.recordSection}>
        <TouchableOpacity activeOpacity={0.8} onPress={handleRecord}>
          <Animated.View style={[s.recBtnOuter, isRecording && s.recBtnOuterRec, { transform: [{ scale: pulseAnim }] }]}>
            <View style={[s.recBtnInner, isRecording && s.recBtnInnerRec]}>
              {isRecording ? <View style={s.stopIcon} /> : <MaterialIcons name="mic" size={40} color="#0a0a12" />}
            </View>
          </Animated.View>
        </TouchableOpacity>
        <Text style={isRecording ? s.recordingLabel : hasRecording ? s.recordedLabel : s.tapLabel}>
          {isRecording ? "RECORDING..." : hasRecording ? "RECORDED" : "CLICK TO RECORD"}
        </Text>
        {duration > 0 && <Text style={s.timer}>{formatTime(duration)}</Text>}
      </View>

      {/* ACTION BUTTON */}
      {hasRecording && (
        <TouchableOpacity
          style={s.actionBtn}
          onPress={uploadedFile ? goToProcessUploaded : goToAutoTune}
        >
          <MaterialIcons name="auto-fix-high" size={20} color="#fff" />
          <Text style={s.actionBtnText}>
            {uploadedFile ? `Process: ${uploadedFile.name}` : "Auto-Tune & Mix"}
          </Text>
        </TouchableOpacity>
      )}

      {/* FEATURE BUTTONS */}
      <View style={s.featureRow}>
        {[
          { icon: "tune", label: "Auto-Tune", desc: "Fix pitch & tune", color: "#A855F7", bg: "rgba(168, 85, 247, 0.12)", onPress: goToAutoTune },
          { icon: "music-note", label: "AI Music", desc: "Generate beats", color: "#06B6D4", bg: "rgba(6, 182, 212, 0.12)", onPress: goToGenerate },
          { icon: "graphic-eq", label: "Effects", desc: "Add reverb & more", color: "#22C55E", bg: "rgba(34, 197, 94, 0.12)", onPress: goToEffects },
          { icon: isUploading ? "hourglass-top" : "file-upload", label: "Upload", desc: isUploading ? "Uploading..." : "Import audio", color: "#F43F5E", bg: "rgba(244, 63, 94, 0.12)", onPress: handleUpload },
        ].map((o) => (
          <TouchableOpacity
            key={o.label}
            style={[s.featureCard, { borderColor: o.color + "30" }]}
            activeOpacity={0.7}
            onPress={o.onPress}
            disabled={isUploading && o.label === "Upload"}
          >
            <View style={[s.featureIcon, { backgroundColor: o.bg, borderColor: o.color + "25" }]}>
              {isUploading && o.label === "Upload" ? (
                <ActivityIndicator size="small" color={o.color} />
              ) : (
                <MaterialIcons name={o.icon} size={26} color={o.color} />
              )}
            </View>
            <Text style={s.featureLabel}>{o.label}</Text>
            <Text style={s.featureDesc}>{o.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* CLEAR BUTTON */}
      {hasRecording && (
        <TouchableOpacity style={s.retakeBtn} onPress={() => { setHasRecording(false); setRecordingUri(null); setDuration(0); setUploadedFile(null); }}>
          <MaterialIcons name="refresh" size={16} color="#6B7280" />
          <Text style={s.retakeText}>{uploadedFile ? "Clear file" : "Re-record"}</Text>
        </TouchableOpacity>
      )}

      {/* FILES SECTION — appears on scroll */}
      <View style={s.filesSection}>
        <View style={s.filesHeader}>
          <MaterialIcons name="folder" size={20} color="#A855F7" />
          <Text style={s.filesTitle}>My Files</Text>
          <Text style={s.filesCount}>{savedFiles.length}</Text>
        </View>

        {savedFiles.length === 0 ? (
          <View style={s.emptyFiles}>
            <MaterialIcons name="audio-file" size={32} color="#374151" />
            <Text style={s.emptyText}>No files yet</Text>
            <Text style={s.emptySubtext}>Record or import audio to see files here</Text>
          </View>
        ) : (
          savedFiles.map((file) => (
            <View key={file.id} style={s.fileItem}>
              <TouchableOpacity style={s.filePlayBtn} onPress={() => playFile(file)}>
                <MaterialIcons name="play-circle-filled" size={28} color="#A855F7" />
              </TouchableOpacity>
              <View style={s.fileInfo}>
                <Text style={s.fileName} numberOfLines={1}>{file.name}</Text>
                <Text style={s.fileMeta}>
                  {file.type === "recording" ? "Recording" : "Upload"}
                  {file.duration ? ` | ${formatTime(file.duration)}` : ""}
                  {" | "}{formatDate(file.date)}
                </Text>
              </View>
              <TouchableOpacity style={s.fileActionBtn} onPress={() => {
                if (file.type === "upload" && file.jobId) {
                  navigation.navigate("Process", { uri: file.uri, duration: 0, lyrics: "", jobId: file.jobId, fromUpload: true });
                } else {
                  navigation.navigate("Process", { uri: file.uri, duration: file.duration || 0, lyrics: "" });
                }
              }}>
                <MaterialIcons name="auto-fix-high" size={18} color="#A855F7" />
              </TouchableOpacity>
              <TouchableOpacity style={s.fileEffectsBtn} onPress={() => {
                navigation.navigate("Effects", { uri: file.uri, jobId: file.jobId });
              }}>
                <MaterialIcons name="graphic-eq" size={18} color="#22C55E" />
              </TouchableOpacity>
              <TouchableOpacity style={s.fileStudioBtn} onPress={() => {
                navigation.navigate("Studio", { uri: file.uri, jobId: file.jobId, filename: file.name });
              }}>
                <MaterialIcons name="equalizer" size={18} color="#06B6D4" />
              </TouchableOpacity>
              <TouchableOpacity style={s.fileDeleteBtn} onPress={() => removeFile(file.id)}>
                <MaterialIcons name="delete-outline" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a12" },
  scrollContent: { paddingBottom: 40 },
  bgOrb1: { position: "absolute", width: 300, height: 300, borderRadius: 150, backgroundColor: "rgba(168, 85, 247, 0.06)", top: -80, right: -100 },
  bgOrb2: { position: "absolute", width: 250, height: 250, borderRadius: 125, backgroundColor: "rgba(6, 182, 212, 0.05)", bottom: 100, left: -80 },
  bgOrb3: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(34, 197, 94, 0.04)", bottom: -50, right: 100 },

  logoSection: { alignItems: "center", marginTop: 50 },
  logo: { fontSize: 38, fontWeight: "900", color: "#A855F7", letterSpacing: 4, textShadowColor: "rgba(168, 85, 247, 0.5)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20 },
  tagline: { fontSize: 11, color: "#7C3AED", marginTop: 6, letterSpacing: 3, fontWeight: "600" },

  recordSection: { alignItems: "center", paddingVertical: 24 },
  recBtnOuter: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: "#A855F7", justifyContent: "center", alignItems: "center", shadowColor: "#A855F7", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20 },
  recBtnOuterRec: { borderColor: "#F43F5E", shadowColor: "#F43F5E" },
  recBtnInner: { width: 118, height: 118, borderRadius: 59, backgroundColor: "#A855F7", justifyContent: "center", alignItems: "center" },
  recBtnInnerRec: { backgroundColor: "#F43F5E" },
  stopIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#fff" },
  recordingLabel: { color: "#F43F5E", fontSize: 12, fontWeight: "700", marginTop: 14, letterSpacing: 1 },
  recordedLabel: { color: "#22C55E", fontSize: 12, fontWeight: "700", marginTop: 14, letterSpacing: 1 },
  tapLabel: { color: "#A855F7", fontSize: 12, fontWeight: "700", marginTop: 14, letterSpacing: 2 },
  timer: { color: "#06B6D4", fontSize: 28, fontWeight: "300", fontFamily: "monospace", marginTop: 10 },

  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 14, marginHorizontal: 20, backgroundColor: "#7C3AED", shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
  actionBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  featureRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", paddingHorizontal: 6, marginTop: 20, gap: 10 },
  featureCard: {
    width: "22%", alignItems: "center", paddingVertical: 16, paddingHorizontal: 4,
    borderRadius: 18, backgroundColor: "rgba(168, 85, 247, 0.05)",
    borderWidth: 1, shadowColor: "#A855F7", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 6, gap: 4,
  },
  featureIcon: { width: 56, height: 56, borderRadius: 16, borderWidth: 1, justifyContent: "center", alignItems: "center", marginBottom: 4 },
  featureLabel: { color: "#E5E7EB", fontSize: 12, fontWeight: "700" },
  featureDesc: { color: "#6B7280", fontSize: 9, fontWeight: "500" },

  retakeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: 12 },
  retakeText: { color: "#6B7280", fontSize: 13, fontWeight: "600" },

  chevronSlider: {
    position: "absolute", left: 0, top: 200, width: 24, height: 72,
    borderTopRightRadius: 10, borderBottomRightRadius: 10,
    backgroundColor: "rgba(168, 85, 247, 0.12)", borderWidth: 1, borderLeftWidth: 0,
    borderColor: "rgba(168, 85, 247, 0.25)", justifyContent: "center", alignItems: "center", zIndex: 20,
  },

  notesPanel: {
    position: "absolute", left: 0, top: 0, bottom: 0, width: NOTES_WIDTH,
    backgroundColor: "#0d0d1a", borderRightWidth: 1, borderRightColor: "rgba(168, 85, 247, 0.15)",
    paddingHorizontal: 16, paddingTop: 50, paddingBottom: 16, zIndex: 30,
  },
  notesHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  notesHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  notesTitle: { color: "#E5E7EB", fontSize: 15, fontWeight: "700" },
  notesCloseBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(107, 114, 128, 0.15)", justifyContent: "center", alignItems: "center" },

  notesToolbar: { flexDirection: "row", gap: 6, marginBottom: 12 },
  tabBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "rgba(168, 85, 247, 0.1)", borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.15)" },
  tabBtnActive: { backgroundColor: "#7C3AED", borderColor: "#A855F7" },
  tabText: { color: "#A855F7", fontSize: 10, fontWeight: "700" },
  tabTextActive: { color: "#fff" },

  notesInput: {
    flex: 1, backgroundColor: "rgba(168, 85, 247, 0.06)", borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.12)", borderRadius: 12, padding: 14,
    color: "#E5E7EB", fontSize: 14, lineHeight: 22, minHeight: 200,
  },
  notesFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  charCount: { color: "#4B5563", fontSize: 11 },
  clearBtn: { color: "#F43F5E", fontSize: 12, fontWeight: "600" },

  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 25 },

  filesSection: {
    marginTop: 30, marginHorizontal: 20, padding: 16,
    backgroundColor: "rgba(168, 85, 247, 0.04)", borderRadius: 18,
    borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.1)",
  },
  filesHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  filesTitle: { color: "#E5E7EB", fontSize: 16, fontWeight: "700", flex: 1 },
  filesCount: { color: "#A855F7", fontSize: 13, fontWeight: "700", backgroundColor: "rgba(168, 85, 247, 0.15)", paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10 },
  emptyFiles: { alignItems: "center", paddingVertical: 28, gap: 6 },
  emptyText: { color: "#6B7280", fontSize: 14, fontWeight: "600" },
  emptySubtext: { color: "#4B5563", fontSize: 12 },
  fileItem: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 8,
    backgroundColor: "rgba(168, 85, 247, 0.06)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(168, 85, 247, 0.08)",
  },
  filePlayBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  fileInfo: { flex: 1 },
  fileName: { color: "#E5E7EB", fontSize: 13, fontWeight: "600" },
  fileMeta: { color: "#6B7280", fontSize: 10, marginTop: 2 },
  fileActionBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(168, 85, 247, 0.12)", justifyContent: "center", alignItems: "center" },
  fileEffectsBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(34, 197, 94, 0.12)", justifyContent: "center", alignItems: "center" },
  fileStudioBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(6, 182, 212, 0.12)", justifyContent: "center", alignItems: "center" },
  fileDeleteBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(107, 114, 128, 0.1)", justifyContent: "center", alignItems: "center" },
});
