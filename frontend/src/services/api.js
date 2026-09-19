const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

import axios from "axios";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";

const api = axios.create({ baseURL: API_BASE, timeout: 300000 });

const MIME_TO_EXT = { "audio/wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/flac": "flac", "audio/aac": "aac" };
const EXT_TO_MIME = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", webm: "audio/webm" };

function getExtForBlob(blob, fallbackName) {
  if (blob?.type && MIME_TO_EXT[blob.type]) return MIME_TO_EXT[blob.type];
  const ext = fallbackName.split(".").pop().toLowerCase();
  return ext || "wav";
}

export async function uploadAudio(fileUri, fileName, preloadedBlob) {
  const formData = new FormData();
  if (Platform.OS === "web") {
    let blob = preloadedBlob;
    if (!blob) {
      const resp = await fetch(fileUri);
      if (!resp.ok) throw new Error("Failed to read audio file. Try re-uploading.");
      blob = await resp.blob();
    }
    if (blob.size < 100) throw new Error("Audio file is empty or too small. Record or re-upload audio.");
    const ext = getExtForBlob(blob, fileName);
    const type = EXT_TO_MIME[ext] || blob.type || "audio/wav";
    const baseName = fileName.replace(/\.[^.]+$/, "");
    formData.append("file", new File([blob], `${baseName}.${ext}`, { type }));
  } else {
    const ext = fileName.split(".").pop().toLowerCase();
    const type = EXT_TO_MIME[ext] || "audio/wav";
    formData.append("file", { uri: fileUri, name: fileName, type });
  }

  const { data } = await api.post("/api/audio/upload", formData);
  return data;
}

export async function analyzeAudio(filename) {
  const { data } = await api.get(`/api/audio/analyze/${filename}`);
  return data;
}

export async function processFull(jobId, options = {}) {
  if (Platform.OS === "web") {
    const params = new URLSearchParams();
    params.append("job_id", jobId);
    if (options.key) params.append("key", options.key);
    if (options.scale) params.append("scale", options.scale || "major");
    params.append("correction_strength", String(options.correction_strength ?? 0.8));
    params.append("pitch_shift", String(options.pitch_shift ?? 0));

    const { data } = await api.post("/api/audio/process", params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return data;
  }

  const formData = new FormData();
  formData.append("job_id", jobId);
  if (options.key) formData.append("key", options.key);
  if (options.scale) formData.append("scale", options.scale || "major");
  formData.append("correction_strength", String(options.correction_strength ?? 0.8));
  formData.append("pitch_shift", String(options.pitch_shift ?? 0));

  const { data } = await api.post("/api/audio/process", formData);
  return data;
}

export async function autotuneOnly(fileUri, fileName, options = {}) {
  const formData = new FormData();
  if (Platform.OS === "web") {
    const resp = await fetch(fileUri);
    if (!resp.ok) throw new Error("Failed to read audio file. Try re-uploading.");
    const blob = await resp.blob();
    if (blob.size < 100) throw new Error("Audio file is empty or too small. Record or re-upload audio.");
    const ext = getExtForBlob(blob, fileName);
    const type = EXT_TO_MIME[ext] || blob.type || "audio/wav";
    const baseName = fileName.replace(/\.[^.]+$/, "");
    formData.append("file", new File([blob], `${baseName}.${ext}`, { type }));
  } else {
    const ext = fileName.split(".").pop().toLowerCase();
    const type = EXT_TO_MIME[ext] || "audio/wav";
    formData.append("file", { uri: fileUri, name: fileName, type });
  }
  if (options.key) formData.append("key", options.key);
  if (options.scale) formData.append("scale", options.scale);
  formData.append("correction_strength", String(options.correction_strength ?? 0.8));
  formData.append("pitch_shift", String(options.pitch_shift ?? 0));

  const { data } = await api.post("/api/audio/autotune", formData);
  return data;
}

export async function generateMusic(prompt, duration = 10) {
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("duration", String(duration));

  const { data } = await api.post("/api/generate/music", formData);
  return data;
}

export async function downloadFile(url) {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const filename = url.split("/").pop() || "output.wav";
  if (Platform.OS === "web") {
    const link = document.createElement("a");
    link.href = fullUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return fullUrl;
  }
  try {
    const localUri = `${FileSystem.documentDirectory}${filename}`;
    const { uri } = await FileSystem.downloadAsync(fullUrl, localUri);
    return uri;
  } catch {
    return fullUrl;
  }
}

export function getAudioUrl(url) {
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
}

export async function applyEffects(jobId, effects) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("effects", JSON.stringify(effects));

  const { data } = await api.post("/api/audio/effects", formData);
  return data;
}

export async function voiceSwap(originalUri, originalName, voiceUri, voiceName, options = {}) {
  const formData = new FormData();
  if (Platform.OS === "web") {
    const [origResp, voiceResp] = await Promise.all([fetch(originalUri), fetch(voiceUri)]);
    if (!origResp.ok) throw new Error("Failed to read original song.");
    if (!voiceResp.ok) throw new Error("Failed to read voice recording.");
    const [origBlob, voiceBlob] = await Promise.all([origResp.blob(), voiceResp.blob()]);
    if (origBlob.size < 100) throw new Error("Original song file is empty or too small.");
    if (voiceBlob.size < 100) throw new Error("Voice recording is empty or too small.");
    const ext1 = getExtForBlob(origBlob, originalName);
    const ext2 = getExtForBlob(voiceBlob, voiceName);
    const type1 = EXT_TO_MIME[ext1] || origBlob.type || "audio/wav";
    const type2 = EXT_TO_MIME[ext2] || voiceBlob.type || "audio/wav";
    const baseName1 = originalName.replace(/\.[^.]+$/, "");
    const baseName2 = voiceName.replace(/\.[^.]+$/, "");
    formData.append("original", new File([origBlob], `${baseName1}.${ext1}`, { type: type1 }));
    formData.append("voice", new File([voiceBlob], `${baseName2}.${ext2}`, { type: type2 }));
  } else {
    const ext1 = originalName.split(".").pop().toLowerCase();
    const ext2 = voiceName.split(".").pop().toLowerCase();
    const type1 = EXT_TO_MIME[ext1] || "audio/wav";
    const type2 = EXT_TO_MIME[ext2] || "audio/wav";
    formData.append("original", { uri: originalUri, name: originalName, type: type1 });
    formData.append("voice", { uri: voiceUri, name: voiceName, type: type2 });
  }
  formData.append("correction_strength", String(options.correction_strength ?? 0.8));
  formData.append("pitch_shift", String(options.pitch_shift ?? 0));

  const { data } = await api.post("/api/audio/voice-swap", formData, { timeout: 600000, signal: options.signal });
  return data;
}

export async function createAudioPlayer(uri, onStatus) {
  if (Platform.OS === "web") {
    const audio = new window.Audio(uri);
    audio.crossOrigin = "anonymous";
    audio.addEventListener("ended", () => {
      onStatus?.({ isLoaded: true, isPlaying: false, didJustFinish: true, positionMillis: audio.duration * 1000, durationMillis: audio.duration * 1000 });
    });
    audio.addEventListener("timeupdate", () => {
      onStatus?.({ isLoaded: true, isPlaying: !audio.paused, positionMillis: audio.currentTime * 1000, durationMillis: audio.duration * 1000, didJustFinish: false });
    });
    await audio.play();
    return {
      play: () => audio.play(),
      pause: () => audio.pause(),
      unload: () => { audio.pause(); audio.src = ""; },
      getStatus: () => ({ isLoaded: true, isPlaying: !audio.paused, positionMillis: audio.currentTime * 1000, durationMillis: audio.duration * 1000 }),
    };
  }
  const { Audio } = await import("expo-av");
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, onStatus);
  return {
    play: () => sound.playAsync(),
    pause: () => sound.pauseAsync(),
    unload: () => sound.unloadAsync(),
    getStatus: () => sound.getStatusAsync(),
  };
}

export { API_BASE };

export async function getWaveform(jobId, numPoints = 2000) {
  const { data } = await api.get(`/api/audio/editor/waveform/${jobId}`, { params: { num_points: numPoints } });
  return data;
}

export async function editorCut(jobId, startTime, endTime) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("start_time", String(startTime));
  formData.append("end_time", String(endTime));
  const { data } = await api.post("/api/audio/editor/cut", formData);
  return data;
}

export async function editorTrim(jobId, startTime, endTime) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("start_time", String(startTime));
  formData.append("end_time", String(endTime));
  const { data } = await api.post("/api/audio/editor/trim", formData);
  return data;
}

export async function editorReverse(jobId, startTime = null, endTime = null) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  if (startTime !== null) formData.append("start_time", String(startTime));
  if (endTime !== null) formData.append("end_time", String(endTime));
  const { data } = await api.post("/api/audio/editor/reverse", formData);
  return data;
}

export async function editorSilence(jobId, startTime, endTime) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("start_time", String(startTime));
  formData.append("end_time", String(endTime));
  const { data } = await api.post("/api/audio/editor/silence", formData);
  return data;
}

export async function editorNormalize(jobId, targetDb = -18, startTime = null, endTime = null) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("target_db", String(targetDb));
  if (startTime !== null) formData.append("start_time", String(startTime));
  if (endTime !== null) formData.append("end_time", String(endTime));
  const { data } = await api.post("/api/audio/editor/normalize", formData);
  return data;
}

export async function editorFade(jobId, fadeInMs = 0, fadeOutMs = 0, startTime = null, endTime = null) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("fade_in_ms", String(fadeInMs));
  formData.append("fade_out_ms", String(fadeOutMs));
  if (startTime !== null) formData.append("start_time", String(startTime));
  if (endTime !== null) formData.append("end_time", String(endTime));
  const { data } = await api.post("/api/audio/editor/fade", formData);
  return data;
}

export async function editorEffectRegion(jobId, effectName, effectParams, startTime, endTime) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("effect_name", effectName);
  formData.append("effect_params", JSON.stringify(effectParams));
  formData.append("start_time", String(startTime));
  formData.append("end_time", String(endTime));
  const { data } = await api.post("/api/audio/editor/effect-region", formData);
  return data;
}
