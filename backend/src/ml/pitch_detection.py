import numpy as np
import librosa
import soundfile as sf
import crepe
import scipy.signal
from pathlib import Path


def detect_pitch(audio_path: str, sr: int = 22050) -> dict:
    """Detect pitch (f0) from audio using CREPE."""
    y, orig_sr = librosa.load(audio_path, sr=sr, mono=True)

    time, frequency, confidence, activation = crepe.predict(
        y, sr, viterbi=True, confidence_threshold=0.1
    )

    median_freq = scipy.signal.medfilt(frequency, kernel_size=9)

    voiced_mask = confidence > 0.3
    voiced_freqs = median_freq[voiced_mask]
    voiced_times = time[voiced_mask]

    detected_key = None
    if len(voiced_freqs) > 0:
        midi_notes = librosa.hz_to_midi(voiced_freqs[voiced_freqs > 0])
        pitch_class = librosa.midi_to_note(midi_notes, octaves=True)
        unique, counts = np.unique(pitch_class, return_counts=True)
        detected_key = unique[np.argmax(counts)]

    return {
        "times": time.tolist(),
        "frequencies": median_freq.tolist(),
        "confidence": confidence.tolist(),
        "voiced_times": voiced_times.tolist(),
        "voiced_frequencies": voiced_freqs.tolist(),
        "detected_key": detected_key,
        "duration": float(time[-1]) if len(time) > 0 else 0.0,
        "sample_rate": sr,
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
