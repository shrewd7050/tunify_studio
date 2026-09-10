import numpy as np
import librosa
import soundfile as sf
from pathlib import Path


def load_audio(path: str, sr: int = 44100) -> tuple:
    y, sr = librosa.load(path, sr=sr, mono=True)
    return y, sr


def save_audio(y: np.ndarray, path: str, sr: int = 44100) -> None:
    sf.write(path, y, sr)


def get_audio_info(path: str) -> dict:
    info = sf.info(path)
    y, sr = load_audio(path)
    rms = float(np.sqrt(np.mean(y ** 2)))
    peak = float(np.max(np.abs(y)))
    return {
        "duration": info.duration,
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "format": info.format,
        "rms_level": rms,
        "peak_level": peak,
        "total_samples": len(y),
    }


def get_waveform_data(path: str, num_points: int = 2000) -> dict:
    y, sr = load_audio(path)
    total = len(y)
    if total <= num_points:
        return {"waveform": y.tolist(), "sample_rate": sr, "total_samples": total}
    chunk = total // num_points
    peaks = []
    for i in range(num_points):
        s = i * chunk
        e = min(s + chunk, total)
        segment = y[s:e]
        peaks.append(float(np.max(np.abs(segment))) if len(segment) > 0 else 0.0)
    return {"waveform": peaks, "sample_rate": sr, "total_samples": total}


def cut_region(path: str, output_path: str, start_time: float, end_time: float) -> dict:
    y, sr = load_audio(path)
    start_sample = int(start_time * sr)
    end_sample = int(end_time * sr)
    start_sample = max(0, start_sample)
    end_sample = min(len(y), end_sample)
    cut_audio = np.concatenate([y[:start_sample], y[end_sample:]])
    save_audio(cut_audio, output_path, sr)
    return {
        "success": True,
        "duration": float(len(cut_audio) / sr),
        "removed_duration": float((end_sample - start_sample) / sr),
    }


def trim_region(path: str, output_path: str, start_time: float, end_time: float) -> dict:
    y, sr = load_audio(path)
    start_sample = int(start_time * sr)
    end_sample = int(end_time * sr)
    start_sample = max(0, start_sample)
    end_sample = min(len(y), end_sample)
    trimmed = y[start_sample:end_sample]
    save_audio(trimmed, output_path, sr)
    return {"success": True, "duration": float(len(trimmed) / sr)}


def copy_region(path: str, start_time: float, end_time: float) -> dict:
    y, sr = load_audio(path)
    start_sample = int(start_time * sr)
    end_sample = int(end_time * sr)
    start_sample = max(0, start_sample)
    end_sample = min(len(y), end_sample)
    copied = y[start_sample:end_sample]
    return {"audio": copied.tolist(), "sample_rate": sr, "duration": float(len(copied) / sr)}


def paste_audio(path: str, output_path: str, insert_audio: list, insert_time: float) -> dict:
    y, sr = load_audio(path)
    insert = np.array(insert_audio, dtype=np.float32)
    insert_sample = int(insert_time * sr)
    insert_sample = max(0, min(len(y), insert_sample))
    pasted = np.concatenate([y[:insert_sample], insert, y[insert_sample:]])
    save_audio(pasted, output_path, sr)
    return {"success": True, "duration": float(len(pasted) / sr)}


def reverse_region(path: str, output_path: str, start_time: float = None, end_time: float = None) -> dict:
    y, sr = load_audio(path)
    result = y.copy()
    if start_time is not None and end_time is not None:
        start_sample = int(start_time * sr)
        end_sample = int(end_time * sr)
        start_sample = max(0, start_sample)
        end_sample = min(len(y), end_sample)
        result[start_sample:end_sample] = y[start_sample:end_sample][::-1]
    else:
        result = y[::-1]
    save_audio(result, output_path, sr)
    return {"success": True, "duration": float(len(result) / sr)}


def silence_region(path: str, output_path: str, start_time: float, end_time: float) -> dict:
    y, sr = load_audio(path)
    start_sample = int(start_time * sr)
    end_sample = int(end_time * sr)
    start_sample = max(0, start_sample)
    end_sample = min(len(y), end_sample)
    result = y.copy()
    result[start_sample:end_sample] = 0.0
    save_audio(result, output_path, sr)
    return {"success": True, "duration": float(len(result) / sr)}


def normalize_audio(path: str, output_path: str, target_db: float = -18.0,
                    start_time: float = None, end_time: float = None) -> dict:
    y, sr = load_audio(path)
    result = y.copy()
    if start_time is not None and end_time is not None:
        start_sample = int(start_time * sr)
        end_sample = int(end_time * sr)
        start_sample = max(0, start_sample)
        end_sample = min(len(y), end_sample)
        region = y[start_sample:end_sample]
        rms = np.sqrt(np.mean(region ** 2))
        if rms > 1e-8:
            target_rms = 10 ** (target_db / 20.0)
            gain = target_rms / rms
            result[start_sample:end_sample] = region * gain
    else:
        rms = np.sqrt(np.mean(y ** 2))
        if rms > 1e-8:
            target_rms = 10 ** (target_db / 20.0)
            result = y * (target_rms / rms)
    peak = np.max(np.abs(result))
    if peak > 0.95:
        result = result * (0.95 / peak)
    save_audio(result, output_path, sr)
    return {"success": True, "duration": float(len(result) / sr)}


def fade_audio(path: str, output_path: str, fade_in_ms: float = 0, fade_out_ms: float = 0,
               start_time: float = None, end_time: float = None) -> dict:
    y, sr = load_audio(path)
    result = y.copy()
    if start_time is not None and end_time is not None:
        start_sample = int(start_time * sr)
        end_sample = int(end_time * sr)
        start_sample = max(0, start_sample)
        end_sample = min(len(y), end_sample)
        region = y[start_sample:end_sample].copy()
        region_len = len(region)
        if fade_in_ms > 0:
            fade_in_samples = min(int(sr * fade_in_ms / 1000), region_len)
            if fade_in_samples > 0:
                region[:fade_in_samples] *= np.linspace(0, 1, fade_in_samples)
        if fade_out_ms > 0:
            fade_out_samples = min(int(sr * fade_out_ms / 1000), region_len)
            if fade_out_samples > 0:
                region[-fade_out_samples:] *= np.linspace(1, 0, fade_out_samples)
        result[start_sample:end_sample] = region
    else:
        if fade_in_ms > 0:
            fade_in_samples = int(sr * fade_in_ms / 1000)
            if fade_in_samples > 0 and fade_in_samples < len(result):
                result[:fade_in_samples] *= np.linspace(0, 1, fade_in_samples)
        if fade_out_ms > 0:
            fade_out_samples = int(sr * fade_out_ms / 1000)
            if fade_out_samples > 0 and fade_out_samples < len(result):
                result[-fade_out_samples:] *= np.linspace(1, 0, fade_out_samples)
    save_audio(result, output_path, sr)
    return {"success": True, "duration": float(len(result) / sr)}


def apply_region_effect(path: str, output_path: str, effect_name: str, effect_params: dict,
                        start_time: float, end_time: float) -> dict:
    from src.ml.effects import EFFECTS_MAP
    y, sr = load_audio(path)
    start_sample = int(start_time * sr)
    end_sample = int(end_time * sr)
    start_sample = max(0, start_sample)
    end_sample = min(len(y), end_sample)
    region = y[start_sample:end_sample].copy()
    result = y.copy()

    if effect_name not in EFFECTS_MAP:
        return {"success": False, "error": f"Unknown effect: {effect_name}"}

    from src.ml.effects import (
        apply_reverb, apply_echo, apply_chorus, apply_distortion,
        apply_lowpass, apply_highpass, apply_compressor,
        apply_pitch_shift, apply_speed_change,
    )
    fn_map = {
        "reverb": apply_reverb,
        "echo": apply_echo,
        "chorus": apply_chorus,
        "distortion": apply_distortion,
        "lowpass": apply_lowpass,
        "highpass": apply_highpass,
        "compressor": apply_compressor,
        "pitch_up": apply_pitch_shift,
        "pitch_down": apply_pitch_shift,
        "speed_up": apply_speed_change,
        "slow_down": apply_speed_change,
    }
    fn = fn_map.get(effect_name)
    if fn is None:
        return {"success": False, "error": f"Effect not implemented: {effect_name}"}

    params = effect_params.copy()
    if effect_name in ("pitch_up", "pitch_down"):
        params.setdefault("semitones", 2.0 if effect_name == "pitch_up" else -2.0)
    if effect_name in ("speed_up", "slow_down"):
        params.setdefault("speed", 1.2 if effect_name == "speed_up" else 0.8)

    processed_region = fn(region, sr, **{k: v for k, v in params.items() if k != "semitones" or effect_name.startswith("pitch")})
    if effect_name.startswith("pitch"):
        processed_region = fn(region, sr, **params)

    min_len = min(len(result[start_sample:end_sample]), len(processed_region))
    result[start_sample:start_sample + min_len] = processed_region[:min_len]
    save_audio(result, output_path, sr)
    return {"success": True, "duration": float(len(result) / sr)}
