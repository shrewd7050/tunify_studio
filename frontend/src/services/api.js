const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

import axios from "axios";
import * as FileSystem from "expo-file-system";

const api = axios.create({ baseURL: API_BASE, timeout: 120000 });

export async function uploadAudio(fileUri: string, fileName: string) {
  const formData = new FormData();
  formData.append("file", {
    uri: fileUri,
    name: fileName,
    type: "audio/wav",
  } as any);

  const { data } = await api.post("/api/audio/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function analyzeAudio(filename: string) {
  const { data } = await api.get(`/api/audio/analyze/${filename}`);
  return data;
}

export async function processFull(
  jobId: string,
  options: {
    key?: string;
    scale?: string;
    correction_strength?: number;
    pitch_shift?: number;
  } = {}
) {
  const formData = new FormData();
  formData.append("job_id", jobId);
  if (options.key) formData.append("key", options.key);
  if (options.scale) formData.append("scale", options.scale || "major");
  formData.append("correction_strength", String(options.correction_strength ?? 0.8));
  formData.append("pitch_shift", String(options.pitch_shift ?? 0));

  const { data } = await api.post("/api/audio/process", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function autotuneOnly(
  fileUri: string,
  fileName: string,
  options: {
    key?: string;
    scale?: string;
    correction_strength?: number;
    pitch_shift?: number;
  } = {}
) {
  const formData = new FormData();
  formData.append("file", {
    uri: fileUri,
    name: fileName,
    type: "audio/wav",
  } as any);
  if (options.key) formData.append("key", options.key);
  if (options.scale) formData.append("scale", options.scale);
  formData.append("correction_strength", String(options.correction_strength ?? 0.8));
  formData.append("pitch_shift", String(options.pitch_shift ?? 0));

  const { data } = await api.post("/api/audio/autotune", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function generateMusic(prompt: string, duration: number = 10) {
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("duration", String(duration));

  const { data } = await api.post("/api/generate/music", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function downloadFile(url: string): Promise<string> {
  const filename = url.split("/").pop() || "output.wav";
  const localUri = `${FileSystem.documentDirectory}${filename}`;
  const { uri } = await FileSystem.downloadAsync(`${API_BASE}${url}`, localUri);
  return uri;
}

export { API_BASE };
