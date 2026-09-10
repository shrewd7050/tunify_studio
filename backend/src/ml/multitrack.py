import numpy as np
import librosa
import soundfile as sf
from pathlib import Path


def load_track(path: str, target_sr: int = 44100) -> tuple:
    y, sr = librosa.load(path, sr=target_sr, mono=True)
    return y, sr


def align_to_longest(tracks: list) -> list:
    max_len = max(len(t) for t in tracks)
    result = []
    for t in tracks:
        if len(t) < max_len:
            t = np.pad(t, (0, max_len - len(t)))
        result.append(t[:max_len])
    return result


def mix_multitrack(tracks: list, output_path: str, sr: int = 44100) -> dict:
    aligned = align_to_longest(tracks)
    mixed = np.zeros_like(aligned[0])
    for track in aligned:
        mixed = mixed + track
    peak = np.max(np.abs(mixed))
    if peak > 0.95:
        mixed = mixed * (0.95 / peak)
    sf.write(output_path, mixed, sr)
    return {"success": True, "duration": float(len(mixed) / sr), "track_count": len(tracks)}


def apply_track_volume(y: np.ndarray, volume_db: float = 0.0) -> np.ndarray:
    gain = 10 ** (volume_db / 20.0)
    return y * gain


def apply_track_pan(y: np.ndarray, pan: float = 0.0) -> np.ndarray:
    if abs(pan) < 0.01:
        return y
    left_gain = np.sqrt((1 - pan) / 2)
    right_gain = np.sqrt((1 + pan) / 2)
    return np.stack([y * left_gain, y * right_gain], axis=-1)


def apply_track_fade(y: np.ndarray, sr: int, fade_in_ms: float = 0, fade_out_ms: float = 0) -> np.ndarray:
    result = y.copy()
    if fade_in_ms > 0:
        fade_in_samples = int(sr * fade_in_ms / 1000)
        if fade_in_samples > 0 and fade_in_samples < len(result):
            result[:fade_in_samples] *= np.linspace(0, 1, fade_in_samples)
    if fade_out_ms > 0:
        fade_out_samples = int(sr * fade_out_ms / 1000)
        if fade_out_samples > 0 and fade_out_samples < len(result):
            result[-fade_out_samples:] *= np.linspace(1, 0, fade_out_samples)
    return result


def mix_with_controls(track_paths: list, track_controls: list, output_path: str) -> dict:
    sr = 44100
    loaded = []
    for path in track_paths:
        y, _ = load_track(path, sr)
        loaded.append(y)
    aligned = align_to_longest(loaded)
    mixed = np.zeros_like(aligned[0])
    for i, (track, controls) in enumerate(zip(aligned, track_controls)):
        volume_db = controls.get("volume_db", 0.0)
        pan = controls.get("pan", 0.0)
        mute = controls.get("mute", False)
        solo = controls.get("solo", False)
        fade_in = controls.get("fade_in_ms", 0)
        fade_out = controls.get("fade_out_ms", 0)
        if mute:
            continue
        track = apply_track_volume(track, volume_db)
        if fade_in > 0 or fade_out > 0:
            track = apply_track_fade(track, sr, fade_in, fade_out)
        if abs(pan) > 0.01:
            stereo_track = apply_track_pan(track, pan)
            if mixed.ndim == 1:
                mixed = np.stack([mixed, mixed], axis=-1)
            if mixed.shape[-1] == 1:
                mixed = np.concatenate([mixed, mixed], axis=-1)
            min_len = min(len(mixed), len(stereo_track))
            mixed[:min_len] = mixed[:min_len] + stereo_track[:min_len]
        else:
            if mixed.ndim == 2:
                track_mono = track
                if len(track_mono) < len(mixed):
                    track_mono = np.pad(track_mono, (0, len(mixed) - len(track_mono)))
                mixed[:, 0] += track_mono[:len(mixed)]
                mixed[:, 1] += track_mono[:len(mixed)]
            else:
                mixed[:len(track)] += track[:len(mixed)]
    peak = np.max(np.abs(mixed))
    if peak > 0.95:
        mixed = mixed * (0.95 / peak)
    sf.write(output_path, mixed, sr)
    return {
        "success": True,
        "duration": float(len(mixed) / sr),
        "sample_rate": sr,
        "track_count": len(track_paths),
    }


def add_layer(base_path: str, layer_path: str, output_path: str,
              layer_start_time: float = 0.0, layer_volume_db: float = 0.0) -> dict:
    sr = 44100
    base, _ = load_track(base_path, sr)
    layer, _ = load_track(layer_path, sr)
    layer = apply_track_volume(layer, layer_volume_db)
    start_sample = int(layer_start_time * sr)
    if start_sample < len(base):
        padded_base = np.pad(base, (0, max(0, start_sample + len(layer) - len(base))))
        padded_layer = np.zeros_like(padded_base)
        padded_layer[start_sample:start_sample + len(layer)] = layer
        mixed = padded_base + padded_layer
    else:
        padded_base = np.pad(base, (0, start_sample + len(layer) - len(base)))
        padded_layer = np.zeros_like(padded_base)
        padded_layer[start_sample:start_sample + len(layer)] = layer
        mixed = padded_base + padded_layer
    peak = np.max(np.abs(mixed))
    if peak > 0.95:
        mixed = mixed * (0.95 / peak)
    sf.write(output_path, mixed, sr)
    return {"success": True, "duration": float(len(mixed) / sr)}
