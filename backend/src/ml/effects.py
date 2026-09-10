import numpy as np
import librosa
import soundfile as sf
from pathlib import Path


def apply_reverb(y: np.ndarray, sr: int, amount: float = 0.3, decay: float = 0.5) -> np.ndarray:
    delays_ms = [23, 37, 53, 71, 97, 113]
    result = y.copy()
    for delay_ms in delays_ms:
        delay_samples = int(sr * delay_ms / 1000)
        if delay_samples < len(y):
            delayed = np.zeros_like(y)
            delayed[delay_samples:] = y[:-delay_samples] * (decay ** (delay_ms / 50.0))
            result = result + delayed * amount
    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak
    return result


def apply_echo(y: np.ndarray, sr: int, delay_ms: float = 300, decay: float = 0.4, repeats: int = 3) -> np.ndarray:
    result = y.copy()
    delay_samples = int(sr * delay_ms / 1000)
    for i in range(1, repeats + 1):
        offset = delay_samples * i
        if offset < len(y):
            echo = np.zeros_like(y)
            echo[offset:] = y[:-offset] * (decay ** i)
            result = result + echo
    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak
    return result


def apply_chorus(y: np.ndarray, sr: int, depth_ms: float = 2.0, rate_hz: float = 1.5, mix: float = 0.4) -> np.ndarray:
    t = np.arange(len(y)) / sr
    mod = depth_ms / 1000.0 * np.sin(2 * np.pi * rate_hz * t)
    indices = np.arange(len(y)) + (mod * sr).astype(int)
    indices = np.clip(indices, 0, len(y) - 1)
    modulated = y[indices]
    result = y * (1 - mix) + modulated * mix
    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak
    return result


def apply_distortion(y: np.ndarray, gain: float = 2.0, mix: float = 0.3) -> np.ndarray:
    driven = np.tanh(y * gain)
    result = y * (1 - mix) + driven * mix
    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak
    return result


def apply_lowpass(y: np.ndarray, sr: int, cutoff_hz: float = 3000) -> np.ndarray:
    nyq = sr / 2.0
    normalized_cutoff = cutoff_hz / nyq
    normalized_cutoff = min(normalized_cutoff, 0.99)
    b = np.array([1 - normalized_cutoff])
    a = np.array([1, -normalized_cutoff])
    from scipy.signal import lfilter
    result = lfilter(b, a, y)
    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak
    return result


def apply_highpass(y: np.ndarray, sr: int, cutoff_hz: float = 200) -> np.ndarray:
    nyq = sr / 2.0
    normalized_cutoff = cutoff_hz / nyq
    normalized_cutoff = max(normalized_cutoff, 0.01)
    b = np.array([1, -1]) * 0.5
    a = np.array([1, -normalized_cutoff])
    from scipy.signal import lfilter
    result = lfilter(b, a, y)
    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak
    return result


def apply_compressor(y: np.ndarray, sr: int, threshold_db: float = -20, ratio: float = 4.0, attack_ms: float = 10, release_ms: float = 100) -> np.ndarray:
    from scipy.signal import lfilter
    threshold = 10 ** (threshold_db / 20.0)
    attack_coeff = np.exp(-1.0 / max(int(sr * attack_ms / 1000), 1))
    release_coeff = np.exp(-1.0 / max(int(sr * release_ms / 1000), 1))

    abs_y = np.abs(y)
    n = len(y)
    envelope = np.zeros(n)
    env_val = 0.0
    for i in range(n):
        coeff = attack_coeff if abs_y[i] > env_val else release_coeff
        env_val = coeff * env_val + (1.0 - coeff) * abs_y[i]
        envelope[i] = env_val

    gain = np.where(
        envelope > threshold,
        np.where(envelope > 0, (threshold + (envelope - threshold) / ratio) / envelope, 1.0),
        1.0,
    )

    result = y * gain
    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak
    return result


def apply_pitch_shift(y: np.ndarray, sr: int, semitones: float = 0.0) -> np.ndarray:
    if abs(semitones) < 0.01:
        return y
    result = librosa.effects.pitch_shift(y.astype(np.float32), sr=sr, n_steps=float(semitones))
    return result


def apply_speed_change(y: np.ndarray, sr: int, speed: float = 1.0) -> np.ndarray:
    if abs(speed - 1.0) < 0.01:
        return y
    result = librosa.effects.time_stretch(y.astype(np.float32), rate=speed)
    return result


EFFECTS_MAP = {
    "reverb": {"fn": "apply_reverb", "params": {"amount": 0.3, "decay": 0.5}},
    "echo": {"fn": "apply_echo", "params": {"delay_ms": 300, "decay": 0.4, "repeats": 3}},
    "chorus": {"fn": "apply_chorus", "params": {"depth_ms": 2.0, "rate_hz": 1.5, "mix": 0.4}},
    "distortion": {"fn": "apply_distortion", "params": {"gain": 2.0, "mix": 0.3}},
    "lowpass": {"fn": "apply_lowpass", "params": {"cutoff_hz": 3000}},
    "highpass": {"fn": "apply_highpass", "params": {"cutoff_hz": 200}},
    "compressor": {"fn": "apply_compressor", "params": {"threshold_db": -20, "ratio": 4.0}},
    "pitch_up": {"fn": "apply_pitch_shift", "params": {"semitones": 2.0}},
    "pitch_down": {"fn": "apply_pitch_shift", "params": {"semitones": -2.0}},
    "speed_up": {"fn": "apply_speed_change", "params": {"speed": 1.2}},
    "slow_down": {"fn": "apply_speed_change", "params": {"speed": 0.8}},
}


def apply_effects(input_path: str, output_path: str, effects: list) -> dict:
    y, sr = librosa.load(input_path, sr=44100, mono=True)

    for effect in effects:
        name = effect.get("name", "")
        params = effect.get("params", {})

        if name not in EFFECTS_MAP:
            continue

        fn_name = EFFECTS_MAP[name]["fn"]
        default_params = EFFECTS_MAP[name]["params"].copy()
        default_params.update(params)

        fn = globals().get(fn_name)
        if fn is None:
            continue

        if fn_name in ("apply_reverb", "apply_echo", "apply_chorus"):
            y = fn(y, sr, **{k: v for k, v in default_params.items() if k in fn.__code__.co_varnames})
        elif fn_name in ("apply_lowpass", "apply_highpass"):
            y = fn(y, sr, **{k: v for k, v in default_params.items() if k in fn.__code__.co_varnames})
        elif fn_name == "apply_compressor":
            y = fn(y, sr, **{k: v for k, v in default_params.items() if k in fn.__code__.co_varnames})
        elif fn_name == "apply_pitch_shift":
            y = fn(y, sr, **{k: v for k, v in default_params.items() if k in fn.__code__.co_varnames})
        elif fn_name == "apply_speed_change":
            y = fn(y, sr, **{k: v for k, v in default_params.items() if k in fn.__code__.co_varnames})
        else:
            y = fn(y, **default_params)

    sf.write(output_path, y, sr)

    return {
        "success": True,
        "effects_applied": [e.get("name") for e in effects],
        "duration": float(len(y) / sr),
        "output_path": output_path,
    }
