import numpy as np
import librosa
import soundfile as sf
import scipy.signal
from pathlib import Path


def detect_pitch(audio_path: str, sr: int = 22050) -> dict:
    """Detect pitch (f0) from audio using librosa's piptrack."""
    y, orig_sr = librosa.load(audio_path, sr=sr, mono=True)

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'), sr=sr
    )

    times = librosa.times_like(f0, sr=sr)
    frequency = np.nan_to_num(f0)
    confidence = np.nan_to_num(voiced_probs)

    median_freq = scipy.signal.medfilt(frequency, kernel_size=9)

    voiced_mask = confidence > 0.3
    voiced_freqs = median_freq[voiced_mask]
    voiced_times = times[voiced_mask]

    detected_key = None
    if len(voiced_freqs) > 0:
        positive_freqs = voiced_freqs[voiced_freqs > 0]
        if len(positive_freqs) > 0:
            midi_notes = librosa.hz_to_midi(positive_freqs)
            pitch_class = librosa.midi_to_note(midi_notes, octaves=True)
            unique, counts = np.unique(pitch_class, return_counts=True)
            detected_key = unique[np.argmax(counts)]

    return {
        "times": times.tolist(),
        "frequencies": median_freq.tolist(),
        "confidence": confidence.tolist(),
        "voiced_times": voiced_times.tolist(),
        "voiced_frequencies": voiced_freqs.tolist(),
        "detected_key": detected_key,
        "duration": float(times[-1]) if len(times) > 0 else 0.0,
        "sample_rate": sr,
    }


def analyze_vocal_profile(audio_path: str) -> dict:
    """Analyze vocal frequency profile for mixing balance."""
    y, sr = librosa.load(audio_path, sr=44100, mono=True)

    rms = np.sqrt(np.mean(y ** 2))
    peak = np.max(np.abs(y))

    spectral_centroid = np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))
    spectral_rolloff = np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr))

    bands = {
        "sub_bass": (20, 60),
        "bass": (60, 250),
        "low_mid": (250, 500),
        "mid": (500, 2000),
        "high_mid": (2000, 4000),
        "presence": (4000, 6000),
        "brilliance": (6000, 20000),
    }

    S = np.abs(librosa.stft(y, n_fft=4096))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    band_energy = {}
    total_energy = np.mean(S)
    for name, (lo, hi) in bands.items():
        mask = (freqs >= lo) & (freqs < hi)
        band_energy[name] = float(np.mean(S[mask])) / (total_energy + 1e-8)

    dominant_band = max(band_energy, key=band_energy.get)

    if spectral_centroid < 1500:
        vocal_range = "bass/baritone"
    elif spectral_centroid < 3000:
        vocal_range = "tenor/alto"
    else:
        vocal_range = "soprano/high"

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'), sr=sr
    )
    voiced_f0 = f0[~np.isnan(f0)]
    avg_pitch = float(np.mean(voiced_f0)) if len(voiced_f0) > 0 else 0.0
    pitch_range = float(np.max(voiced_f0) - np.min(voiced_f0)) if len(voiced_f0) > 1 else 0.0

    return {
        "rms": float(rms),
        "peak": float(peak),
        "spectral_centroid": float(spectral_centroid),
        "spectral_rolloff": float(spectral_rolloff),
        "band_energy": band_energy,
        "dominant_band": dominant_band,
        "vocal_range": vocal_range,
        "avg_pitch_hz": avg_pitch,
        "pitch_range_hz": pitch_range,
        "duration": float(len(y) / sr),
    }


def detect_key_and_scale(audio_path: str) -> dict:
    """Detect musical key and scale from audio."""
    y, sr = librosa.load(audio_path, sr=22050)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_avg = np.mean(chroma, axis=1)

    key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    detected_key_idx = np.argmax(chroma_avg)

    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    major_scores = []
    minor_scores = []
    for shift in range(12):
        rolled = np.roll(chroma_avg, -shift)
        major_scores.append(np.corrcoef(rolled, major_profile)[0, 1])
        minor_scores.append(np.corrcoef(rolled, minor_profile)[0, 1])

    best_major_idx = np.argmax(major_scores)
    best_minor_idx = np.argmax(minor_scores)

    is_major = major_scores[best_major_idx] > minor_scores[best_minor_idx]
    key_idx = best_major_idx if is_major else best_minor_idx
    scale = "major" if is_major else "minor"

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    if hasattr(tempo, '__len__'):
        tempo = float(tempo[0])
    else:
        tempo = float(tempo)

    return {
        "key": key_names[key_idx],
        "scale": scale,
        "tempo": tempo,
        "confidence": float(max(major_scores[best_major_idx], minor_scores[best_minor_idx])),
    }
