import logging
import numpy as np
import librosa
import soundfile as sf
from pathlib import Path

logger = logging.getLogger("tunify")


def load_and_resample(audio_path: str, target_sr: int = 44100) -> tuple:
    """Load audio and resample to target sample rate."""
    y, sr = librosa.load(audio_path, sr=target_sr, mono=True)
    return y, sr


def align_lengths(*tracks) -> list:
    """Pad or trim all tracks to the length of the longest."""
    max_len = max(len(t) for t in tracks)
    result = []
    for t in tracks:
        if len(t) < max_len:
            t = np.pad(t, (0, max_len - len(t)))
        elif len(t) > max_len:
            t = t[:max_len]
        result.append(t)
    return result


def normalize_audio(y: np.ndarray, target_db: float = -20.0) -> np.ndarray:
    """Normalize audio to a target dB level."""
    rms = np.sqrt(np.mean(y ** 2))
    if rms < 1e-8:
        return y
    target_rms = 10 ** (target_db / 20.0)
    return y * (target_rms / rms)


def apply_fade(y: np.ndarray, sr: int, fade_in_ms: float = 50, fade_out_ms: float = 100) -> np.ndarray:
    """Apply fade in/out to audio."""
    fade_in_samples = int(sr * fade_in_ms / 1000)
    fade_out_samples = int(sr * fade_out_ms / 1000)

    result = y.copy()

    if fade_in_samples > 0 and fade_in_samples < len(result):
        fade_in = np.linspace(0, 1, fade_in_samples)
        result[:fade_in_samples] *= fade_in

    if fade_out_samples > 0 and fade_out_samples < len(result):
        fade_out = np.linspace(1, 0, fade_out_samples)
        result[-fade_out_samples:] *= fade_out

    return result


def mix_tracks(
    vocal_path: str,
    backing_path: str,
    output_path: str,
    vocal_volume_db: float = 0.0,
    backing_volume_db: float = -3.0,
    vocal_pan: float = 0.0,
    backing_pan: float = 0.0,
    apply_reverb: bool = False,
    reverb_amount: float = 0.2,
    crossfade_ms: float = 500,
) -> dict:
    """
    Mix vocal and backing tracks together.

    Args:
        vocal_path: Path to the (auto-tuned) vocal track
        backing_path: Path to the AI-generated backing track
        output_path: Path to save the mixed output
        vocal_volume_db: Volume adjustment for vocals
        backing_volume_db: Volume adjustment for backing
        vocal_pan: Pan vocals (-1.0 left, 0.0 center, 1.0 right)
        backing_pan: Pan backing track
        apply_reverb: Whether to apply reverb to vocals
        reverb_amount: Reverb wet/dry mix (0.0 - 1.0)
    """
    vocal, sr = load_and_resample(vocal_path, target_sr=44100)
    backing, _ = load_and_resample(backing_path, target_sr=44100)

    vocal, backing = align_lengths(vocal, backing)

    vocal = normalize_audio(vocal, target_db=-18.0)
    backing = normalize_audio(backing, target_db=-20.0)

    vocal_gain = 10 ** (vocal_volume_db / 20.0)
    backing_gain = 10 ** (backing_volume_db / 20.0)

    vocal = vocal * vocal_gain
    backing = backing * backing_gain

    vocal, backing = _apply_multiband_processing(vocal, backing, sr)

    if apply_reverb and reverb_amount > 0:
        vocal = _simple_reverb(vocal, sr, amount=reverb_amount)

    if abs(vocal_pan) > 0.01:
        vocal = _apply_stereo_pan(vocal, vocal_pan)

    if abs(backing_pan) > 0.01:
        backing = _apply_stereo_pan(backing, backing_pan)

    mixed = vocal + backing

    peak = np.max(np.abs(mixed))
    if peak > 0.95:
        mixed = mixed * (0.95 / peak)

    fade_samples = int(sr * crossfade_ms / 1000)
    if fade_samples > 0 and fade_samples < len(mixed):
        fade_in = np.linspace(0, 1, fade_samples)
        mixed[:fade_samples] *= fade_in
        mixed[-fade_samples:] *= np.linspace(1, 0, fade_samples)

    if mixed.ndim == 1:
        stereo = np.stack([mixed, mixed], axis=-1)
    else:
        stereo = mixed

    sf.write(output_path, stereo, sr)

    return {
        "success": True,
        "duration": float(len(mixed) / sr),
        "sample_rate": sr,
        "output_path": output_path,
    }


def _simple_reverb(y: np.ndarray, sr: int, amount: float = 0.2, decay: float = 0.5) -> np.ndarray:
    """Simple delay-based reverb effect."""
    delays_ms = [23, 37, 53, 71, 97]
    result = y.copy()

    for delay_ms in delays_ms:
        delay_samples = int(sr * delay_ms / 1000)
        delayed = np.zeros_like(y)
        if delay_samples < len(y):
            delayed[delay_samples:] = y[:-delay_samples] * (decay ** (delay_ms / 50.0))
        result = result + delayed * amount

    peak = np.max(np.abs(result))
    if peak > 0:
        result = result / peak

    return result


def _apply_stereo_pan(y: np.ndarray, pan: float) -> np.ndarray:
    """Apply stereo panning to mono audio. Returns stereo."""
    left_gain = np.sqrt((1 - pan) / 2)
    right_gain = np.sqrt((1 + pan) / 2)
    stereo = np.stack([y * left_gain, y * right_gain], axis=-1)
    return stereo.flatten() if stereo.shape[-1] == 2 else stereo


def _apply_eq_band(y: np.ndarray, sr: int, center_hz: float, gain_db: float, q: float = 1.0) -> np.ndarray:
    """Apply a single peaking EQ band."""
    from scipy.signal import lfilter
    w0 = 2 * np.pi * center_hz / sr
    A = 10 ** (gain_db / 40.0)
    alpha = np.sin(w0) / (2 * q)
    b0 = 1 + alpha * A
    b1 = -2 * np.cos(w0)
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * np.cos(w0)
    a2 = 1 - alpha / A
    b = np.array([b0 / a0, b1 / a0, b2 / a0])
    a = np.array([1.0, a1 / a0, a2 / a0])
    return lfilter(b, a, y)


def _boost_bass(y: np.ndarray, sr: int, boost_db: float = 2.0) -> np.ndarray:
    """Boost low-end bass frequencies."""
    y = _apply_eq_band(y, sr, 80, boost_db, q=0.7)
    y = _apply_eq_band(y, sr, 150, boost_db * 0.6, q=1.0)
    peak = np.max(np.abs(y))
    if peak > 0:
        y = y / peak
    return y


def _carve_vocal_space(y: np.ndarray, sr: int) -> np.ndarray:
    """Cut low-mid frequencies in backing to make room for vocals."""
    y = _apply_eq_band(y, sr, 350, -3.0, q=1.2)
    y = _apply_eq_band(y, sr, 800, -2.0, q=1.0)
    peak = np.max(np.abs(y))
    if peak > 0:
        y = y / peak
    return y


def _apply_sidechain_ducking(vocal: np.ndarray, backing: np.ndarray, sr: int, amount: float = 0.15) -> np.ndarray:
    """Duck backing track volume when vocals are present."""
    hop = 512
    n_frames = 1 + len(vocal) // hop
    vocal_env = np.zeros(n_frames)
    for i in range(n_frames):
        s = i * hop
        e = min(s + hop, len(vocal))
        vocal_env[i] = np.sqrt(np.mean(vocal[s:e] ** 2))

    vocal_env = np.maximum(vocal_env, 0.0)
    threshold = np.mean(vocal_env) * 1.2
    duck = np.ones(n_frames)
    mask = vocal_env > threshold
    duck[mask] = 1.0 - amount * ((vocal_env[mask] - threshold) / (np.max(vocal_env) - threshold + 1e-8))

    duck_samples = np.interp(np.arange(len(backing)), np.arange(n_frames) * hop, duck)
    return backing * duck_samples


def _apply_multiband_processing(vocal: np.ndarray, backing: np.ndarray, sr: int) -> tuple:
    """Apply frequency-aware processing to vocal + backing pair."""
    backing = _carve_vocal_space(backing, sr)
    backing = _boost_bass(backing, sr, boost_db=1.5)
    backing = _apply_sidechain_ducking(vocal, backing, sr, amount=0.12)
    vocal = _apply_eq_band(vocal, sr, 3000, 1.5, q=1.0)
    vocal = _apply_eq_band(vocal, sr, 120, -2.0, q=0.8)
    vocal_peak = np.max(np.abs(vocal))
    if vocal_peak > 0:
        vocal = vocal / vocal_peak
    return vocal, backing


def separate_vocals(audio_path: str, output_dir: str) -> dict:
    """Separate vocals from accompaniment using Demucs."""
    import subprocess
    import os

    os.makedirs(output_dir, exist_ok=True)

    try:
        cmd = [
            "python", "-m", "demucs",
            "--out", output_dir,
            "--two-stems", "vocals",
            audio_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            logger.error(f"demucs failed (rc={result.returncode}): {result.stderr[:500]}")
            return {"success": False, "error": result.stderr[:300] or "demucs process failed"}

        audio_name = Path(audio_path).stem
        vocals_path = os.path.join(output_dir, "htdemucs", audio_name, "vocals.wav")
        accompaniment_path = os.path.join(output_dir, "htdemucs", audio_name, "no_vocals.wav")

        if not os.path.exists(accompaniment_path):
            for root, dirs, files in os.walk(output_dir):
                for f in files:
                    if f == "no_vocals.wav":
                        accompaniment_path = os.path.join(root, f)
                        break

        if not os.path.exists(vocals_path):
            for root, dirs, files in os.walk(output_dir):
                for f in files:
                    if f == "vocals.wav":
                        vocals_path = os.path.join(root, f)
                        break

        if not os.path.exists(accompaniment_path):
            logger.error(f"demucs output not found: {accompaniment_path}")
            return {"success": False, "error": f"No output file found after demucs separation"}

        return {
            "success": True,
            "vocals_path": vocals_path,
            "accompaniment_path": accompaniment_path,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
