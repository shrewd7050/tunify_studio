import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  Dimensions,
} from "react-native";
import { Audio } from "expo-av";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import styles from "../styles/theme";

const { width } = Dimensions.get("window");

export default function RecordScreen({ navigation }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState(null);
  const [waveformBars] = useState(new Animated.Value(0));

  const recordingRef = useRef(null);
  const timerRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
      setDuration(0);
      setHasRecording(false);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const stopRecording = async () => {
    try {
      if (!recordingRef.current) return;

      clearInterval(timerRef.current);
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recordingRef.current.getURI();
      setRecordingUri(uri);
      setIsRecording(false);
      setHasRecording(true);
      recordingRef.current = null;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Failed to stop recording:", err);
    }
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const goToProcess = () => {
    if (recordingUri) {
      navigation.navigate("Process", { uri: recordingUri, duration });
    }
  };

  return (
    <View style={styles.homeContainer}>
      {/* Header */}
      <View style={styles.logoContainer}>
        <Text style={styles.logo}>TUNIFY</Text>
        <Text style={styles.tagline}>AI-POWERED AUTO-TUNE</Text>
      </View>

      {/* Waveform Visualization */}
      {isRecording && (
        <View style={localStyles.waveformContainer}>
          <View style={localStyles.waveformBars}>
            {Array.from({ length: 40 }).map((_, i) => (
              <Animated.View
                key={i}
                style={[
                  localStyles.bar,
                  {
                    height: pulseAnim.interpolate({
                      inputRange: [1, 1.15],
                      outputRange: [
                        8 + Math.random() * 30,
                        20 + Math.random() * 50,
                      ],
                    }),
                    opacity: 0.5 + Math.random() * 0.5,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      )}

      {/* Record Button */}
      <View style={styles.recordSection}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleRecord}
          style={isRecording ? styles.recordButtonRecording : styles.recordButton}
        >
          <Animated.View
            style={[
              isRecording
                ? styles.recordButtonInnerRecording
                : styles.recordButtonInner,
              !isRecording && { transform: [{ scale: pulseAnim }] },
            ]}
          />
        </TouchableOpacity>

        {isRecording ? (
          <Text style={styles.recordLabelRecording}>TAP TO STOP</Text>
        ) : hasRecording ? (
          <Text style={styles.recordLabelRecording}>RECORDED</Text>
        ) : (
          <Text style={[styles.recordLabel, { color: "#00FF88", marginTop: 16 }]}>
            TAP TO RECORD
          </Text>
        )}

        {duration > 0 && (
          <Text style={styles.timerText}>{formatTime(duration)}</Text>
        )}
      </View>

      {/* Bottom Options */}
      {hasRecording ? (
        <View style={{ gap: 12 }}>
          <TouchableOpacity
            style={localStyles.processButton}
            onPress={goToProcess}
            activeOpacity={0.8}
          >
            <MaterialIcons name="auto-fix-high" size={22} color="#0a0a0a" />
            <Text style={localStyles.processButtonText}>Auto-Tune & Mix</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={localStyles.retakeButton}
            onPress={() => {
              setHasRecording(false);
              setRecordingUri(null);
              setDuration(0);
            }}
          >
            <Text style={styles.retakeText}>Re-record</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.optionsRow}>
          <TouchableOpacity style={styles.optionButton}>
            <View style={styles.optionIcon}>
              <MaterialIcons name="tune" size={22} color="#00FF88" />
            </View>
            <Text style={styles.optionLabel}>Auto-Tune</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.optionButton}>
            <View style={styles.optionIcon}>
              <MaterialIcons name="music-note" size={22} color="#00FF88" />
            </View>
            <Text style={styles.optionLabel}>AI Music</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.optionButton}>
            <View style={styles.optionIcon}>
              <MaterialIcons name="graphic-eq" size={22} color="#00FF88" />
            </View>
            <Text style={styles.optionLabel}>Effects</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  waveformContainer: {
    height: 80,
    backgroundColor: "#111",
    borderRadius: 16,
    overflow: "hidden",
    marginHorizontal: 24,
  },
  waveformBars: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  bar: {
    width: 3,
    backgroundColor: "#00FF88",
    borderRadius: 2,
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
  retakeButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
});
